import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export interface IcsSource {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  last_synced_at: string | null;
  synced_event_count: number;
  created_at: string;
}

export function useIcsSources() {
  return useQuery<IcsSource[]>({
    queryKey: ['ics-sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ics_sources')
        .select('id, name, url, is_active, last_synced_at, synced_event_count, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as IcsSource[];
    },
    staleTime: 60_000,
  });
}

export function useCreateIcsSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, url }: { name: string; url: string }) => {
      const { error } = await supabase.from('ics_sources').insert({ name, url });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ics-sources'] });
      toast.success('Źródło kalendarza dodane');
    },
    onError: (e: Error) => toast.error('Błąd', { description: e.message }),
  });
}

export function useDeleteIcsSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ics_sources').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ics-sources'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success('Źródło usunięte');
    },
    onError: (e: Error) => toast.error('Błąd', { description: e.message }),
  });
}

export function useSyncIcsSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak aktywnej sesji');

      const res = await fetch('/api/integracje?op=ics_sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourceId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }

      return res.json() as Promise<{ imported: number; total: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['ics-sources'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      toast.success('Synchronizacja zakończona', {
        description: `Zaimportowano ${data.imported} z ${data.total} wydarzeń`,
      });
    },
    onError: (e: Error) =>
      toast.error('Błąd synchronizacji', { description: e.message }),
  });
}
