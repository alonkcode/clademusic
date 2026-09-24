import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { SystemSettingsProvider, useRateLimitGuard, useSystemSettings } from '@/hooks/useSystemSettings';
import { FeatureRoute } from '@/components/FeatureRoute';
import { MaintenanceGate } from '@/components/MaintenanceGate';
import { clearRateLimit } from '@/lib/security';

// What the fake database returns, and who is signed in, are set per test.
const db = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: unknown }>,
  error: null as { message: string } | null,
  user: null as { id: string } | null,
  isAdmin: false,
  toasts: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: db.error ? null : db.rows, error: db.error }),
    }),
    rpc: () => Promise.resolve({ data: db.isAdmin, error: null }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: db.user, loading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (options: unknown) => db.toasts.push(options),
}));

beforeEach(() => {
  db.rows = [];
  db.error = null;
  db.user = null;
  db.isAdmin = false;
  db.toasts = [];
  clearRateLimit('limit.comments');
});

function Providers({ children, path = '/' }: { children: ReactNode; path?: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <SystemSettingsProvider>
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          {children}
        </MemoryRouter>
      </SystemSettingsProvider>
    </QueryClientProvider>
  );
}

function renderForum() {
  return render(
    <Providers path="/forum">
      <Routes>
        <Route element={<FeatureRoute flag="flag.forum_enabled" name="Forums" />}>
          <Route path="/forum" element={<div>forum content</div>} />
        </Route>
      </Routes>
    </Providers>
  );
}

describe('FeatureRoute', () => {
  it('renders the page while its flag is on', async () => {
    renderForum();
    expect(await screen.findByText('forum content')).toBeInTheDocument();
  });

  it('replaces the page with an unavailable notice once an admin turns the flag off', async () => {
    db.rows = [{ key: 'flag.forum_enabled', value: false }];
    renderForum();

    expect(await screen.findByText('Forums is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('forum content')).not.toBeInTheDocument();
  });

  it('never flashes a disabled page while settings are still loading', async () => {
    db.rows = [{ key: 'flag.forum_enabled', value: false }];
    renderForum();

    // The very first render, before the fetch resolves, must not show the page.
    expect(screen.queryByText('forum content')).not.toBeInTheDocument();
    await screen.findByText('Forums is unavailable');
  });

  it('falls back to the defaults (everything on) if settings cannot be loaded', async () => {
    db.error = { message: 'relation "system_settings" does not exist' };
    renderForum();

    expect(await screen.findByText('forum content')).toBeInTheDocument();
  });
});

describe('useRateLimitGuard', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <Providers>{children}</Providers>;
  // Exposes the loaded limit next to the guard, so a test can wait for the
  // stored value to replace the default before it starts counting.
  const useProbe = () => ({
    guard: useRateLimitGuard('limit.comments'),
    limit: useSystemSettings().settings['limit.comments'],
  });

  it('allows up to the configured count, then refuses and tells the user', async () => {
    db.rows = [{ key: 'limit.comments', value: { max: 2, windowSeconds: 60 } }];
    const { result } = renderHook(useProbe, { wrapper });
    await waitFor(() => expect(result.current.limit.max).toBe(2));

    expect(result.current.guard()).toBe(true);
    expect(result.current.guard()).toBe(true);
    expect(db.toasts).toHaveLength(0);

    expect(result.current.guard()).toBe(false);
    expect(db.toasts).toHaveLength(1);
    expect(db.toasts[0]).toMatchObject({ title: 'Slow down', variant: 'destructive' });
  });

  it('never refuses when the limit is set to 0', async () => {
    db.rows = [{ key: 'limit.comments', value: { max: 0, windowSeconds: 60 } }];
    const { result } = renderHook(useProbe, { wrapper });
    await waitFor(() => expect(result.current.limit.max).toBe(0));

    for (let i = 0; i < 50; i += 1) expect(result.current.guard()).toBe(true);
    expect(db.toasts).toHaveLength(0);
  });
});

describe('MaintenanceGate', () => {
  function renderApp(path = '/') {
    return render(
      <Providers path={path}>
        <MaintenanceGate>
          <Routes>
            <Route path="/" element={<div>the site</div>} />
            <Route path="/login" element={<div>login form</div>} />
          </Routes>
        </MaintenanceGate>
      </Providers>
    );
  }

  it('is invisible while maintenance mode is off', async () => {
    renderApp();
    expect(await screen.findByText('the site')).toBeInTheDocument();
  });

  it('shows visitors the admin-written message instead of the site', async () => {
    db.rows = [
      { key: 'pref.maintenance_mode', value: true },
      { key: 'pref.maintenance_message', value: 'Back at noon.' },
    ];
    renderApp();

    expect(await screen.findByText('Back at noon.')).toBeInTheDocument();
    expect(screen.queryByText('the site')).not.toBeInTheDocument();
  });

  it('keeps the sign-in page reachable so an admin can get past it', async () => {
    db.rows = [{ key: 'pref.maintenance_mode', value: true }];
    renderApp('/login');

    expect(await screen.findByText('login form')).toBeInTheDocument();
  });

  it('lets a signed-in admin through', async () => {
    db.rows = [{ key: 'pref.maintenance_mode', value: true }];
    db.user = { id: 'admin-1' };
    db.isAdmin = true;
    renderApp();

    expect(await screen.findByText('the site')).toBeInTheDocument();
  });

  it('still blocks a signed-in user who is not an admin', async () => {
    db.rows = [{ key: 'pref.maintenance_mode', value: true }];
    db.user = { id: 'user-1' };
    db.isAdmin = false;
    renderApp();

    expect(await screen.findByText('Down for maintenance')).toBeInTheDocument();
    expect(screen.queryByText('the site')).not.toBeInTheDocument();
  });
});
