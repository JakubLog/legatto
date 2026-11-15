import type { ContactType } from '@/integrations/supabase/types';

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  wyborca: 'Wyborca',
  dziennikarz: 'Dziennikarz',
  samorządowiec: 'Samorządowiec',
  sołtys: 'Sołtys',
  inne: 'Inne',
};

export const CONTACT_TYPES: ContactType[] = [
  'wyborca',
  'dziennikarz',
  'samorządowiec',
  'sołtys',
  'inne',
];

/** Kolor kropki typu kontaktu (pill: neutralne tło + kolorowa kropka). */
export const CONTACT_TYPE_DOT: Record<ContactType, string> = {
  wyborca: 'bg-primary',
  dziennikarz: 'bg-amber-500',
  samorządowiec: 'bg-emerald-500',
  sołtys: 'bg-sky-500',
  inne: 'bg-muted-foreground/60',
};

/** Miękkie tło awatara z inicjałami - spójne z kolorem typu. */
export const CONTACT_TYPE_AVATAR: Record<ContactType, string> = {
  wyborca: 'bg-primary/10 text-primary',
  dziennikarz: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  samorządowiec: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  sołtys: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  inne: 'bg-muted text-muted-foreground',
};
