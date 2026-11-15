import { CONTACT_TYPE_AVATAR, CONTACT_TYPE_DOT, CONTACT_TYPE_LABELS } from '@/lib/contacts';
import type { ContactType } from '@/integrations/supabase/types';
import { cn } from '@/lib/utils';

interface AvatarProps {
  firstName: string;
  lastName: string;
  type: ContactType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const AVATAR_SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-base',
} as const;

/** Okrągły awatar z inicjałami kontaktu, kolor zależny od typu. */
export function ContactAvatar({ firstName, lastName, type, size = 'sm', className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        AVATAR_SIZES[size],
        CONTACT_TYPE_AVATAR[type],
        className,
      )}
    >
      {`${firstName.trim()[0] ?? ''}${lastName.trim()[0] ?? ''}`.toLocaleUpperCase('pl-PL')}
    </span>
  );
}

/** Pill typu kontaktu: neutralne tło + kolorowa kropka. */
export function ContactTypePill({ type, className }: { type: ContactType; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80',
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', CONTACT_TYPE_DOT[type])} />
      {CONTACT_TYPE_LABELS[type]}
    </span>
  );
}
