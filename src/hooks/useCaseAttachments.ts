import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invalidateCaseHistory } from '@/hooks/useCaseHistory';

export interface CaseAttachment {
  id: string;
  case_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

export function useCaseAttachments(caseId: string | null) {
  return useQuery<CaseAttachment[]>({
    queryKey: ['case-attachments', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_attachments')
        .select('id, case_id, storage_path, filename, mime_type, size_bytes, created_by, created_at')
        .eq('case_id', caseId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CaseAttachment[];
    },
    enabled: Boolean(caseId),
    staleTime: 30_000,
  });
}

/** Zawartość pliku (żądanie z tokenem sesji, bez publicznego linku) - do podglądu i zapisu na dysku. */
export async function fetchCaseAttachmentBlob(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from('case-attachments').download(storagePath);
  if (error || !data) throw error ?? new Error('Brak pliku');
  return data;
}

export function useUploadCaseAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, file }: { caseId: string; file: File }) => {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const path = `${caseId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext ? `.${ext}` : ''}`;

      const { error: uploadError } = await supabase.storage
        .from('case-attachments')
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('case_attachments')
        .insert({
          case_id: caseId,
          storage_path: path,
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        });
      if (dbError) {
        // Best-effort cleanup - nie blokuj usera błędem storage jeśli DB odrzuciło insert.
        await supabase.storage.from('case-attachments').remove([path]);
        throw dbError;
      }
    },
    onSuccess: (_data, { caseId }) => {
      qc.invalidateQueries({ queryKey: ['case-attachments', caseId] });
      invalidateCaseHistory(qc, caseId);
    },
  });
}

export function useDeleteCaseAttachment() {
  const qc = useQueryClient();
  return useMutation({
    // Plik zostaje w storage, dopóki załącznik jest w koszu; po usunięciu z kosza sprząta go
    // nocny cron (`case_attachments_orphan_objects`).
    mutationFn: async ({ id }: { id: string; caseId: string }) => {
      const { error } = await supabase.from('case_attachments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, { caseId }) => {
      qc.invalidateQueries({ queryKey: ['case-attachments', caseId] });
      invalidateCaseHistory(qc, caseId);
    },
  });
}
