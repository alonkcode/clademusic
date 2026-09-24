import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSetting } from '@/hooks/useSystemSettings';
import { LoadingSpinner } from '@/components/shared';

// Reachable during maintenance so an admin can sign in to get past the gate.
const SIGN_IN_PATHS = new Set(['/login', '/auth', '/reset-password', '/confirm-email']);

function MaintenanceScreen() {
  const message = useSetting('pref.maintenance_message');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center">
      <Wrench className="w-16 h-16 text-muted-foreground" />
      <h1 className="text-2xl font-bold">Down for maintenance</h1>
      <p className="max-w-md text-muted-foreground">{message}</p>
      <Link to="/login" className="text-xs text-muted-foreground underline hover:text-foreground">
        Admin sign in
      </Link>
    </div>
  );
}

function ActiveMaintenanceGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user, loading } = useAuth();

  // Keyed by user, unlike useIsAdmin: that one caches a single answer for five
  // minutes, so an admin who signs in from the gate would still be shown the
  // maintenance screen using the "not an admin" answer from before they did.
  const { data: isAdmin, isLoading: checkingAdmin } = useQuery({
    queryKey: ['isAdmin', 'maintenance', user?.id ?? null],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_role', { _user_id: user!.id, _role: 'admin' });
      return !error && data === true;
    },
  });

  if (SIGN_IN_PATHS.has(pathname)) return <>{children}</>;

  if (loading || (!!user && checkingAdmin)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  return isAdmin ? <>{children}</> : <MaintenanceScreen />;
}

/** Replaces the app with a maintenance screen for everyone but admins while pref.maintenance_mode is on. */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const maintenance = useSetting('pref.maintenance_mode');
  // Split so the admin lookup only runs while maintenance is actually on.
  return maintenance ? <ActiveMaintenanceGate>{children}</ActiveMaintenanceGate> : <>{children}</>;
}
