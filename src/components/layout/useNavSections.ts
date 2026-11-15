import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getNavSections, type NavSection } from './navigation';

/** Sekcje nawigacji bieżącego użytkownika według roli. */
export function useNavSections(): NavSection[] {
  const { profile } = useAuth();
  const role = profile?.role;
  return useMemo(() => getNavSections(role), [role]);
}
