import { Outlet, useNavigate } from 'react-router-dom';
import { PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/shared';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import type { FlagKey } from '@/lib/systemSettings';

/**
 * Layout route that renders its children only while an admin feature flag is
 * on. Waits for the first settings fetch so a disabled page never flashes
 * before being taken away.
 */
export function FeatureRoute({ flag, name }: { flag: FlagKey; name: string }) {
  const { settings, isLoading } = useSystemSettings();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (!settings[flag]) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center">
        <PowerOff className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">{name} is unavailable</h2>
        <p className="text-muted-foreground">This feature is switched off for now. Please check back later.</p>
        <Button onClick={() => navigate('/')}>Go Home</Button>
      </div>
    );
  }

  return <Outlet />;
}
