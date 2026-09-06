import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageLayout } from './PageLayout';

// ProfileCircle (rendered by every PageLayout header) needs an AuthProvider
// and a QueryClient; this test only cares about the layout's own classes,
// not auth/profile state.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

/**
 * BottomNav's own floating hamburger button is fixed at top-left,
 * independently of whatever header a page renders - without left clearance,
 * a page's own header content renders directly under it and is largely
 * hidden (e.g. "Profile" reading as "ile"). Also guards against the
 * fixed-header + content padding regression - pt-16 (real clearance) and a
 * separate py-4 (generic breathing room) used to both apply at once,
 * roughly doubling the dead space above the content on every fixedHeader
 * page.
 */

function renderLayout(props: Partial<React.ComponentProps<typeof PageLayout>> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PageLayout title="Following" {...props}>
          <div>content</div>
        </PageLayout>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PageLayout', () => {
  it('reserves left clearance for the hamburger button around the title', () => {
    const { container } = renderLayout();
    const headerInner = container.querySelector('header > div');
    expect(headerInner?.className).toMatch(/pl-14/);
    expect(headerInner?.className).not.toMatch(/\bpx-4\b/);
  });

  it('reserves the same left clearance around custom headerContent too', () => {
    const { container } = renderLayout({ headerContent: <div>Custom</div> });
    const headerInner = container.querySelector('header > div');
    expect(headerInner?.className).toMatch(/pl-14/);
  });

  it('does not stack a generic top padding on top of the fixed-header clearance', () => {
    const { container } = renderLayout({ fixedHeader: true });
    const main = container.querySelector('main');
    // Exactly one top-padding utility, not pt-* alongside a separate py-4
    // that would add a second, redundant gap above the content.
    expect(main?.className).toMatch(/\bpt-\d/);
    expect(main?.className).not.toMatch(/\bpy-4\b/);
  });

  it('still gives sticky-header pages their own small top breathing room', () => {
    const { container } = renderLayout({ fixedHeader: false });
    const main = container.querySelector('main');
    expect(main?.className).toMatch(/\bpt-4\b/);
  });
});
