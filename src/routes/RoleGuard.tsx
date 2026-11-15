import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { AppRole } from '@/integrations/supabase/types';

interface RoleGuardProps {
  allow: AppRole[];
  fallback?: string;
}

export function RoleGuard({ allow, fallback = '/' }: RoleGuardProps) {
  const { profile } = useAuth();

  if (!profile || !allow.includes(profile.role)) {
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
