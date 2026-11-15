import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useModuleOwners } from '@/hooks/useModuleOwners';
import { OWNED_MODULES } from '@/lib/moduleOwners';

/** "Twoje obszary": moduły, za które zalogowana osoba odpowiada według podziału obowiązków. */
export function MyModules() {
  const { profile } = useAuth();
  const { data: owners = [] } = useModuleOwners();

  const mine = OWNED_MODULES.filter((m) =>
    owners.some((o) => o.module === m.module && o.user_id === profile?.id),
  );
  if (mine.length === 0) return null;

  return (
    <section aria-label="Twoje obszary" className="flex flex-wrap items-center gap-2 max-md:gap-2.5">
      <span className="text-xs font-medium text-muted-foreground">Twoje obszary:</span>
      {mine.map((m) => (
        <Link
          key={m.module}
          to={m.to}
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-muted max-md:min-h-10 max-md:px-4 max-md:text-sm"
        >
          <m.Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
          {m.label}
        </Link>
      ))}
    </section>
  );
}
