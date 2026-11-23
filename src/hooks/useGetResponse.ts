import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { SECRET_SETTINGS_STATUS_KEY, saveSecretSetting } from '@/hooks/useSecretSettings';
import { INSTANCE } from '@/lib/instance';

// ============================================================================
// Settings (app_settings) - Posel only via RLS
// Klucz API (getresponse_api_key) jest write-only: status przez useSecretSettingsStatus,
// zapis przez set_secret_setting. Tu tylko ustawienia niesekretne.
// ============================================================================

const GR_KEYS = [
  'getresponse_default_list_id',
  'getresponse_from_field_id',
  'getresponse_from_name',
  'getresponse_from_email',
  'getresponse_reply_to_email',
] as const;

type GrKey = (typeof GR_KEYS)[number];

export interface GetResponseSettings {
  default_list_id: string;
  from_field_id: string;
  from_name: string;
  from_email: string;
  reply_to_email: string;
}

export interface GetResponseSettingsUpdate extends Partial<GetResponseSettings> {
  /** undefined = bez zmian; pusty string / null = usun klucz; inaczej nowy klucz. */
  api_key?: string | null;
}

const KEY_TO_FIELD: Record<GrKey, keyof GetResponseSettings> = {
  getresponse_default_list_id: 'default_list_id',
  getresponse_from_field_id: 'from_field_id',
  getresponse_from_name: 'from_name',
  getresponse_from_email: 'from_email',
  getresponse_reply_to_email: 'reply_to_email',
};

const FIELD_TO_KEY = Object.fromEntries(
  Object.entries(KEY_TO_FIELD).map(([k, v]) => [v, k as GrKey]),
) as Record<keyof GetResponseSettings, GrKey>;

const EMPTY_SETTINGS: GetResponseSettings = {
  default_list_id: '',
  from_field_id: '',
  from_name: '',
  from_email: '',
  reply_to_email: '',
};

export function useGetResponseSettings() {
  return useQuery<GetResponseSettings>({
    queryKey: ['gr-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key,value')
        .in('key', [...GR_KEYS]);
      if (error) throw error;

      const out = { ...EMPTY_SETTINGS };
      for (const row of data ?? []) {
        const field = KEY_TO_FIELD[row.key as GrKey];
        if (field) {
          out[field] = typeof row.value === 'string' ? row.value : '';
        }
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateGetResponseSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ api_key, ...patch }: GetResponseSettingsUpdate) => {
      const rows = (Object.entries(patch) as [keyof GetResponseSettings, string | undefined][])
        .filter(([, v]) => typeof v === 'string')
        .map(([field, value]) => ({ key: FIELD_TO_KEY[field], value }));
      if (rows.length > 0) {
        const { error } = await supabase
          .from('app_settings')
          .upsert(rows, { onConflict: 'key' });
        if (error) throw error;
      }
      if (api_key !== undefined) await saveSecretSetting('getresponse_api_key', api_key);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gr-settings'] });
      qc.invalidateQueries({ queryKey: SECRET_SETTINGS_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ['gr-status'] });
    },
  });
}

// ============================================================================
// Proxy do GetResponse API (Edge Function getresponse-proxy)
// ============================================================================

type ProxyAction =
  | 'check_status'
  | 'list_campaigns'
  | 'list_from_fields'
  | 'list_newsletters'
  | 'send_newsletter'
  | 'send_test_newsletter'
  | 'delete_newsletter'
  | 'sync_contact'
  | 'unsync_contact';

async function callProxy<TResponse = unknown>(
  action: ProxyAction,
  payload?: Record<string, unknown>,
): Promise<TResponse> {
  // INSTANCE_GETRESPONSE=off: funkcja zwraca 404 - bez zbędnego wywołania i z czytelnym komunikatem.
  if (!INSTANCE.getresponse) {
    throw Object.assign(new Error('Integracja GetResponse jest wyłączona na tej instancji.'), { code: 'GETRESPONSE_DISABLED' });
  }
  const { data, error } = await supabase.functions.invoke<TResponse>('getresponse-proxy', {
    body: { action, payload },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: string; code?: string };
        if (body?.error) {
          const err = new Error(body.error);
          if (body.code) (err as Error & { code?: string }).code = body.code;
          throw err;
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message) throw parseErr;
      }
    }
    throw new Error(error.message || 'Blad polaczenia z GetResponse');
  }
  if (!data) throw new Error('Pusta odpowiedz proxy');
  return data;
}

export interface GrStatus {
  ok: boolean;
  status?: number;
  account?: { account_id?: string; company_name?: string; email?: string };
  settings_summary?: {
    has_api_key: boolean;
    has_default_list: boolean;
    has_from_field: boolean;
    from_name?: string;
    from_email?: string;
  };
}

export function useGRStatus(enabled = true) {
  return useQuery<GrStatus>({
    queryKey: ['gr-status'],
    queryFn: () => callProxy<GrStatus>('check_status'),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export interface GrCampaign {
  campaignId: string;
  name: string;
  description?: string;
  createdOn?: string;
}

export function useGRCampaigns(enabled = true) {
  return useQuery<GrCampaign[]>({
    queryKey: ['gr-campaigns'],
    queryFn: async () => {
      const r = await callProxy<{ campaigns: GrCampaign[] }>('list_campaigns');
      return r.campaigns ?? [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface GrFromField {
  fromFieldId: string;
  name: string;
  email: string;
  isActive?: 'true' | 'false' | boolean;
}

export function useGRFromFields(enabled = true) {
  return useQuery<GrFromField[]>({
    queryKey: ['gr-from-fields'],
    queryFn: async () => {
      const r = await callProxy<{ from_fields: GrFromField[] }>('list_from_fields');
      return r.from_fields ?? [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface GrNewsletter {
  newsletterId: string;
  name?: string;
  subject?: string;
  status?: string;
  createdOn?: string;
  sendOn?: string;
  sendSettings?: { selectedCampaigns?: string[] };
  sendMetrics?: { status?: string; sent?: string; total?: string };
}

export function useGRNewsletters(enabled = true) {
  return useQuery<GrNewsletter[]>({
    queryKey: ['gr-newsletters'],
    queryFn: async () => {
      const r = await callProxy<{ newsletters: GrNewsletter[] }>('list_newsletters', {
        per_page: 50,
        page: 1,
      });
      return r.newsletters ?? [];
    },
    enabled,
    staleTime: 60_000,
  });
}

export interface SendNewsletterInput {
  name: string;
  subject: string;
  html: string;
  plain?: string;
  list_id: string;
  from_field_id: string;
  reply_to_field_id?: string | null;
  /**
   * Zapisany szkic wydania (newsletter_issues). Proxy rezerwuje go atomowo (status 'sending'),
   * temat kampanii bierze z wydania (pole `subject` wyżej jest ignorowane) i po sukcesie
   * w GetResponse oznacza go jako wysłany; 409 = to wydanie jest już wysyłane albo wysłane.
   */
  issue_id: string;
}

export interface SendNewsletterResult {
  newsletter_id?: string;
  status?: string;
  href?: string;
  /** false = GetResponse wysłał, ale proxy nie oznaczyło wydania jako wysłanego (brak w archiwum). */
  issue_marked?: boolean;
}

export function useSendNewsletter() {
  const qc = useQueryClient();
  return useMutation<SendNewsletterResult, Error, SendNewsletterInput>({
    mutationFn: (input) => callProxy<SendNewsletterResult>('send_newsletter', input as unknown as Record<string, unknown>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gr-newsletters'] });
      qc.invalidateQueries({ queryKey: ['newsletter-issues'] });
    },
  });
}

export interface SendTestNewsletterInput {
  test_email: string;
  name: string;
  subject: string;
  html: string;
  plain?: string;
  list_id: string;
  from_field_id: string;
}

export interface SendTestNewsletterResult {
  newsletter_id?: string;
  status?: string;
  contact_id?: string | null;
}

// Wysylka testowa - tylko do jednego odbiorcy (selectedContacts w GR), nie do calej listy.
export function useSendTestNewsletter() {
  return useMutation<SendTestNewsletterResult, Error, SendTestNewsletterInput>({
    mutationFn: (input) =>
      callProxy<SendTestNewsletterResult>(
        'send_test_newsletter',
        input as unknown as Record<string, unknown>,
      ),
  });
}

export function useDeleteNewsletter() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (newsletterId) =>
      callProxy('delete_newsletter', { newsletter_id: newsletterId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gr-newsletters'] });
    },
  });
}

export interface GRSyncContactInput {
  contact_id: string;
  email: string;
  name?: string;
  list_id?: string;
}

export function useGRSyncContact() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; gr_contact_id: string | null }, Error, GRSyncContactInput>({
    mutationFn: (input) =>
      callProxy('sync_contact', input as unknown as Record<string, unknown>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export interface GRUnsyncContactInput {
  contact_id: string;
  list_id?: string;
}

export function useGRUnsyncContact() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, GRUnsyncContactInput>({
    mutationFn: (input) =>
      callProxy('unsync_contact', input as unknown as Record<string, unknown>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export interface GRBulkConsentInput {
  consent: boolean;
  contacts: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    gr_contact_id: string | null;
  }>;
}

export interface GRBulkConsentResult {
  done: number;
  failed: number;
  /** GetResponse nieskonfigurowany - synchronizacja przerwana bez błędu (jak w formularzu kontaktu). */
  notConfigured: boolean;
}

function isGrNotConfigured(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return msg.includes('GR_NOT_CONFIGURED') || msg.includes('nie jest skonfigurowany');
}

/**
 * Synchronizacja zgód z GetResponse po masowej edycji: dla każdego kontaktu ta sama akcja
 * proxy co w ContactFormDialog (sync_contact / unsync_contact). Sekwencyjnie - bez zalewania API GR.
 */
export function useGRBulkConsentSync() {
  const qc = useQueryClient();
  return useMutation<GRBulkConsentResult, Error, GRBulkConsentInput>({
    mutationFn: async ({ consent, contacts }) => {
      const result: GRBulkConsentResult = { done: 0, failed: 0, notConfigured: false };
      for (const c of contacts) {
        const email = c.email?.trim();
        try {
          if (consent) {
            if (!email) continue;
            await callProxy('sync_contact', {
              contact_id: c.id,
              email,
              name: `${c.first_name} ${c.last_name}`.trim(),
            });
          } else {
            // Proxy bierze email i gr_contact_id z bazy (RLS) - wysyłamy tylko id kontaktu.
            await callProxy('unsync_contact', { contact_id: c.id });
          }
          result.done += 1;
        } catch (err) {
          if (isGrNotConfigured(err)) return { ...result, notConfigured: true };
          result.failed += 1;
        }
      }
      return result;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}
