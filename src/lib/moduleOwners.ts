import { Calendar, FileText, MapPinned, Mail, Wallet, type LucideIcon } from 'lucide-react';
import type { OwnedModule, PulseLevel } from '@/integrations/supabase/types';

export interface OwnedModuleInfo {
  module: OwnedModule;
  label: string;
  to: string;
  Icon: LucideIcon;
}

/** Obszary z opiekunami (CHECK w `module_owners`), w kolejności nawigacji. */
export const OWNED_MODULES: OwnedModuleInfo[] = [
  { module: 'kalendarz', label: 'Kalendarz', to: '/biuro/kalendarz', Icon: Calendar },
  { module: 'teren', label: 'Widoczność w terenie', to: '/biuro/teren', Icon: MapPinned },
  { module: 'interpelacje', label: 'Interpelacje', to: '/biuro/interpelacje', Icon: FileText },
  { module: 'budzet', label: 'Budżet biura', to: '/biuro/budzet', Icon: Wallet },
  { module: 'newsletter', label: 'Newsletter', to: '/biuro/kontakty?widok=kampanie', Icon: Mail },
];

/** Komunikat sygnału po najechaniu na awatar opiekuna. */
export const PULSE_LEVEL_LABELS: Record<PulseLevel, string> = {
  ok: 'Działania w normie',
  warning: 'W ostatnim czasie osłabienie działań',
  critical: 'Bardzo duży spadek działań',
};

/** Newsletter wysyłany co tydzień: ostatnia wysyłka > 7 dni temu = osłabienie, > 14 dni = duży spadek. */
export const NEWSLETTER_WARNING_DAYS = 7;
export const NEWSLETTER_CRITICAL_DAYS = 14;
