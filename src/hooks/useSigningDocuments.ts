import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { SigningFilePayload } from '@/hooks/useSigningFiles';
import {
  SIGNING_STATUSES,
  SIGNING_VIEWS,
  signingViewStatuses,
  type SigningDocument,
  type SigningStatus,
  type SigningView,
} from '@/lib/signing';

export interface SigningListFilters {
  view: SigningView;
  search: string;
  /** Tylko dokumenty utworzone przez zalogowanego użytkownika. */
  mine: boolean;
}

const LIST_LIMIT = 500;
const DOCUMENT_COLUMNS =
  'id, code, title, description, recipient_name, send_subject, send_text, case_id, requires_signature, status, current_version, return_notes, due_date, last_batch_id, sent_note, created_by, created_at, updated_at, signed_at, signed_by, sent_at, cancelled_at';
const FILE_COLUMNS =
  'id, document_id, kind, version, storage_path, filename, mime_type, size_bytes, sha256, is_current, created_by, created_at';

/** Statusy, w których dokument czeka na podpis lub może dostać (nowy) plik podpisu. */
export const SIGNABLE_STATUSES: SigningStatus[] = ['do_podpisu', 'pobrany', 'podpisany'];

function escapeOrToken(input: string): string {
  return input.replace(/[\\,()%*]/g, '');
}

function invalidateSigning(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['signing-documents'] });
  qc.invalidateQueries({ queryKey: ['signing-document'] });
}

/** Lista dokumentów wg widoku (`?widok=`), wyszukiwania i filtra "Moje"; z bieżącymi plikami. */
export function useSigningDocuments(filters: SigningListFilters) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return useQuery<SigningDocument[]>({
    queryKey: ['signing-documents', filters],
    queryFn: async () => {
      const statuses = signingViewStatuses(filters.view);
      let query = supabase
        .from('signing_documents')
        .select(`${DOCUMENT_COLUMNS}, files:signing_document_files(${FILE_COLUMNS})`)
        .eq('files.is_current', true)
        .limit(LIST_LIMIT);
      if (statuses) query = query.in('status', statuses);
      if (filters.mine && userId) query = query.eq('created_by', userId);
      const search = filters.search.trim();
      if (search.length >= 2) {
        const term = `%${escapeOrToken(search)}%`;
        query = query.or(`title.ilike.${term},code.ilike.${term},recipient_name.ilike.${term}`);
      }
      // "Do podpisu": od najstarszych (kolejność paczek); pozostałe widoki: ostatnio zmienione na górze.
      query =
        filters.view === 'do-podpisu'
          ? query.order('created_at', { ascending: true })
          : query.order('updated_at', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SigningDocument[];
    },
    enabled: !filters.mine || Boolean(userId),
    staleTime: 30_000,
  });
}

export interface SigningCounts {
  byView: Record<SigningView, number>;
  byStatus: Record<SigningStatus, number>;
  /** Dokumenty zalogowanego użytkownika w statusie `do_poprawy`. */
  myReturned: number;
  /** Do podpisu z wymogiem podpisu (do_podpisu + pobrany). */
  toSign: number;
  /** `podpisany` - gotowe do wysyłki. */
  readyToSend: number;
}

/** Liczniki widoków i paska "Wymaga działania" (lekkie zapytanie: tylko status i autor). */
export function useSigningCounts(mine: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return useQuery<SigningCounts>({
    queryKey: ['signing-documents', 'counts', { mine }],
    queryFn: async () => {
      let query = supabase.from('signing_documents').select('id, status, requires_signature, created_by').limit(5000);
      if (mine && userId) query = query.eq('created_by', userId);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Pick<SigningDocument, 'id' | 'status' | 'requires_signature' | 'created_by'>[];
      const byStatus = Object.fromEntries(SIGNING_STATUSES.map((s) => [s, 0])) as Record<SigningStatus, number>;
      let myReturned = 0;
      let toSign = 0;
      for (const row of rows) {
        byStatus[row.status] += 1;
        if (row.status === 'do_poprawy' && userId && row.created_by === userId) myReturned += 1;
        if ((row.status === 'do_podpisu' || row.status === 'pobrany') && row.requires_signature) toSign += 1;
      }
      const byView = Object.fromEntries(
        SIGNING_VIEWS.map((v) => [
          v.value,
          v.statuses ? v.statuses.reduce((sum, s) => sum + byStatus[s], 0) : rows.length,
        ]),
      ) as Record<SigningView, number>;
      return { byView, byStatus, myReturned, toSign, readyToSend: byStatus.podpisany };
    },
    enabled: !mine || Boolean(userId),
    staleTime: 30_000,
  });
}

/** Dokumenty, którym można wgrać plik podpisu (podgląd dopasowania w SignedUploadDialog). */
export function useSignableDocuments(enabled: boolean) {
  return useQuery<SigningDocument[]>({
    queryKey: ['signing-documents', { signable: true }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signing_documents')
        .select(`${DOCUMENT_COLUMNS}, files:signing_document_files(${FILE_COLUMNS})`)
        .eq('files.is_current', true)
        .in('status', SIGNABLE_STATUSES)
        .eq('requires_signature', true)
        .order('created_at', { ascending: true })
        .limit(LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as SigningDocument[];
    },
    enabled,
    staleTime: 15_000,
  });
}

/** Szczegóły dokumentu ze wszystkimi plikami (wersje), od najnowszych. */
export function useSigningDocument(id: string | undefined) {
  return useQuery<SigningDocument | null>({
    queryKey: ['signing-document', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signing_documents')
        .select(`${DOCUMENT_COLUMNS}, files:signing_document_files(${FILE_COLUMNS})`)
        .eq('id', id!)
        .order('created_at', { referencedTable: 'files', ascending: false })
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as SigningDocument | null;
    },
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export interface SigningBatchEntry {
  batch_id: string;
  file_id: string;
  zip_name: string;
  position: number;
  batch: { id: string; code: string; created_at: string; created_by: string | null; document_count: number } | null;
}

/** Paczki ZIP, w których był dokument (RLS: tylko Poseł/administrator). */
export function useDocumentBatches(documentId: string | undefined, enabled: boolean) {
  return useQuery<SigningBatchEntry[]>({
    queryKey: ['signing-document', documentId, 'batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signing_batch_items')
        .select('batch_id, file_id, zip_name, position, batch:signing_batches(id, code, created_at, created_by, document_count)')
        .eq('document_id', documentId!);
      if (error) throw error;
      const rows = (data ?? []) as unknown as SigningBatchEntry[];
      return rows.sort((a, b) => (b.batch?.created_at ?? '').localeCompare(a.batch?.created_at ?? ''));
    },
    enabled: Boolean(documentId) && enabled,
    staleTime: 30_000,
  });
}

export interface SigningBatchItem {
  document_id: string;
  file_id: string;
  storage_path: string;
  zip_name: string;
  position: number;
}

export interface SigningBatchResult {
  batch_id: string;
  code: string;
  items: SigningBatchItem[];
}

/** Pozycje zapisanej paczki do ponownego pobrania (bez zmiany statusów). */
export async function fetchBatchForDownload(batchId: string): Promise<{
  batch: SigningBatchResult;
  createdAt: string;
  documents: Pick<SigningDocument, 'id' | 'code' | 'title' | 'recipient_name' | 'created_by'>[];
}> {
  const { data, error } = await supabase
    .from('signing_batches')
    .select(
      'id, code, created_at, items:signing_batch_items(document_id, file_id, zip_name, position, file:signing_document_files(storage_path), document:signing_documents(id, code, title, recipient_name, created_by))',
    )
    .eq('id', batchId)
    .single();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    code: string;
    created_at: string;
    items: {
      document_id: string;
      file_id: string;
      zip_name: string;
      position: number;
      file: { storage_path: string } | null;
      document: Pick<SigningDocument, 'id' | 'code' | 'title' | 'recipient_name' | 'created_by'> | null;
    }[];
  };
  const items = row.items
    .filter((it) => it.file)
    .map((it) => ({
      document_id: it.document_id,
      file_id: it.file_id,
      storage_path: it.file!.storage_path,
      zip_name: it.zip_name,
      position: it.position,
    }))
    .sort((a, b) => a.position - b.position);
  if (items.length === 0) throw new Error('Pliki tej paczki nie są już dostępne.');
  return {
    batch: { batch_id: row.id, code: row.code, items },
    createdAt: row.created_at,
    documents: row.items.map((it) => it.document).filter((d): d is NonNullable<typeof d> => Boolean(d)),
  };
}

// ---------------------------------------------------------------------------
// Mutacje (RPC obiegu)

export interface CreateSigningItem {
  id: string;
  title: string;
  description?: string | null;
  recipient_name?: string | null;
  send_subject?: string | null;
  send_text?: string | null;
  case_id?: string | null;
  requires_signature?: boolean;
  due_date?: string | null;
  file: SigningFilePayload;
}

export function useCreateSigningDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: CreateSigningItem[]) => {
      const { data, error } = await supabase.rpc('signing_create_documents', { p_items: items });
      if (error) throw error;
      return (data ?? []) as { id: string; code: string }[];
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export type SigningDocumentPatch = Partial<
  Pick<
    SigningDocument,
    'title' | 'description' | 'recipient_name' | 'send_subject' | 'send_text' | 'case_id' | 'due_date'
  >
>;

export function useUpdateSigningDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SigningDocumentPatch }) => {
      const { error } = await supabase.rpc('signing_update_document', { p_id: id, p_patch: patch });
      if (error) throw error;
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export function useReplaceOriginal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file, note }: { id: string; file: SigningFilePayload; note: string | null }) => {
      const { error } = await supabase.rpc('signing_replace_original', { p_id: id, p_file: file, p_note: note });
      if (error) throw error;
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export function useReturnDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, notes }: { ids: string[]; notes: string }) => {
      const { error } = await supabase.rpc('signing_return', { p_ids: ids, p_notes: notes });
      if (error) throw error;
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export function useCancelDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string | null }) => {
      const { error } = await supabase.rpc('signing_cancel', { p_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (documentIds: string[]) => {
      const { data, error } = await supabase.rpc('signing_create_batch', { p_document_ids: documentIds });
      if (error) throw error;
      const result = data as SigningBatchResult;
      return { ...result, items: [...result.items].sort((a, b) => a.position - b.position) };
    },
    onSettled: () => invalidateSigning(qc),
  });
}

export interface AttachSignedItem {
  document_id: string;
  version: number;
  kind: 'podpisany' | 'podpis_zewnetrzny';
  file: SigningFilePayload;
}

export function useAttachSigned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: AttachSignedItem[]) => {
      const { error } = await supabase.rpc('signing_attach_signed', { p_items: items });
      if (error) throw error;
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export function useMarkSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, sentAt, note }: { ids: string[]; sentAt: string; note: string | null }) => {
      const { error } = await supabase.rpc('signing_mark_sent', { p_ids: ids, p_sent_at: sentAt, p_note: note });
      if (error) throw error;
    },
    onSuccess: () => invalidateSigning(qc),
  });
}

export function useDeleteSigningDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('signing_delete', { p_id: id });
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ['signing-document', id] });
      invalidateSigning(qc);
    },
  });
}
