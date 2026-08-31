import { Navigate, Outlet } from 'react-router-dom';
import { useIsAdmin } from '@/hooks/api/useAdmin';
import { LoadingSpinner } from '@/components/shared';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function AdminRoute() {
  const { data: isAdmin, isLoading } = useIsAdmin();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <ShieldAlert className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">Access Denied</h2>
        <p className="text-muted-foreground">You don't have permission to access this area.</p>
        <Button onClick={() => navigate('/')}>Go Home</Button>
      </div>
    );
  }

  return <Outlet />;
}
