import { z } from 'zod';
import type { CasePriority, CaseStatus } from '@/integrations/supabase/types';

/** Wartość "brak wyboru" w Radix Select (nie akceptuje pustego stringa). */
export const NONE = '__none__';

export const caseFormSchema = z.object({
  title: z.string().min(2, 'Min. 2 znaki'),
  description: z.string().optional(),
  status: z.enum(['nowa', 'w_toku', 'oczekuje', 'załatwiona', 'odrzucona']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  category_id: z
    .coerce
    .number({ error: 'Wybierz kategorię' })
    .int()
    .positive('Wybierz kategorię'),
  contact_id: z.guid().optional().or(z.literal('').transform(() => undefined)),
  reporter_name: z.string().optional(),
  reporter_phone: z.string().optional(),
  reporter_email: z.string().email('Nieprawidłowy email').optional().or(z.literal('')),
  powiat_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  gmina_id: z.coerce.number().int().positive().optional().or(z.literal('').transform(() => undefined)),
  assigned_to: z.guid('Wybierz osobę odpowiedzialną'),
  due_date: z.string().min(1, 'Wybierz termin'),
  resolution_notes: z.string().optional(),
});

export type CaseFormValues = z.infer<typeof caseFormSchema>;

export const CASE_FORM_DEFAULTS = {
  title: '',
  description: '',
  status: 'nowa' as CaseStatus,
  priority: 'normal' as CasePriority,
  category_id: undefined,
  contact_id: undefined,
  reporter_name: '',
  reporter_phone: '',
  reporter_email: '',
  powiat_id: undefined,
  gmina_id: undefined,
  assigned_to: undefined,
  due_date: '',
  resolution_notes: '',
} satisfies Partial<CaseFormValues>;

export type ReporterMode = 'search' | 'manual';
