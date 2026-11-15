import { UserRound } from 'lucide-react';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useModuleOwners } from '@/hooks/useModuleOwners';
import { useModulePulse } from '@/hooks/useModulePulse';
import { PULSE_LEVEL_LABELS } from '@/lib/moduleOwners';
import type { ModuleOwner, OwnedModule, PulseLevel } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

/** Awatary i imiona osób odpowiedzialnych (lista w panelu podziału obowiązków). */
export function OwnerList({ owners, className }: { owners: ModuleOwner[]; className?: string }) {
  const people = owners.flatMap((o) => (o.user ? [o.user] : []));
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className="flex shrink-0 gap-0.5">
        {people.map((p) => (
          <CreatorAvatar key={p.id} name={p.full_name} avatarUrl={p.avatar_url} className="h-5 w-5" />
        ))}
      </span>
      <span className="truncate font-medium text-foreground">
        {people.map((p) => p.full_name + (p.is_active ? '' : ' (nieaktywne)')).join(', ')}
      </span>
    </span>
  );
}

const GLOW: Record<PulseLevel, string | null> = {
  ok: null,
  warning: 'bg-amber-400/70 shadow-[0_0_10px_3px_rgba(251,191,36,0.8)]',
  critical: 'animate-pulse bg-red-500/70 shadow-[0_0_12px_4px_rgba(239,68,68,0.85)]',
};

const RING: Record<PulseLevel, string> = {
  ok: 'ring-card',
  warning: 'ring-amber-400',
  critical: 'ring-red-500',
};

interface OwnerAvatarsProps {
  owners: ModuleOwner[];
  level?: PulseLevel;
  /** Rozmiar awatara (klasy Tailwind). */
  sizeClassName?: string;
  className?: string;
}

/**
 * Same zdjęcia opiekunów obszaru. Sygnał zaniedbań świeci wokół głowy:
 * żółto (osłabienie działań) albo czerwono (bardzo duży spadek); opis po najechaniu.
 */
export function OwnerAvatars({ owners, level = 'ok', sizeClassName = 'h-7 w-7', className }: OwnerAvatarsProps) {
  const people = owners.flatMap((o) => (o.user ? [o.user] : []));
  const names = people.map((p) => p.full_name).join(', ');
  const signal = level === 'ok' ? null : PULSE_LEVEL_LABELS[level];
  const glow = GLOW[level];

  return (
    <span
      tabIndex={0}
      aria-label={[signal, names ? `Odpowiedzialni: ${names}` : 'Brak osoby odpowiedzialnej']
        .filter(Boolean)
        .join('. ')}
      className={cn('group relative inline-flex shrink-0 items-center gap-1.5 rounded-full outline-none', className)}
    >
      {people.length > 0 ? (
        people.map((p) => (
          <span key={p.id} className="relative inline-flex">
            {glow && <span className={cn('absolute -inset-0.5 rounded-full', glow)} aria-hidden />}
            <CreatorAvatar
              name={p.full_name}
              avatarUrl={p.avatar_url}
              className={cn('relative ring-2', RING[level], sizeClassName)}
            />
          </span>
        ))
      ) : (
        <span
          className={cn(
            'flex items-center justify-center rounded-full border border-dashed text-muted-foreground',
            sizeClassName,
          )}
        >
          <UserRound className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}

      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-max max-w-64 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-normal leading-snug text-background shadow-popover group-hover:block group-focus-visible:block"
      >
        {signal && <span className="block font-semibold">{signal}</span>}
        <span className={cn('block', signal && 'opacity-80')}>
          {names ? `Odpowiedzialni: ${names}` : 'Brak osoby odpowiedzialnej'}
        </span>
      </span>
    </span>
  );
}

/** Opiekunowie obszaru z sygnałem - przy tytule modułu (mniejsze zdjęcia na telefonie). */
export function ModuleOwners({ module, className }: { module: OwnedModule; className?: string }) {
  const { data } = useModuleOwners();
  const pulse = useModulePulse(module);
  if (!data) return null;

  return (
    <OwnerAvatars
      owners={data.filter((o) => o.module === module)}
      level={pulse?.level}
      sizeClassName="h-5 w-5 md:h-7 md:w-7"
      className={cn('max-md:gap-1', className)}
    />
  );
}
