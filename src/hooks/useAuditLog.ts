import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AuditLog } from '@/integrations/supabase/types';

export interface AuditLogFilters {
  action?: string | null; // dokładne dopasowanie, np. 'user.create' lub prefix np. 'case.'
  entityType?: string | null;
  userEmail?: string | null;
  from?: string | null; // ISO date (yyyy-mm-dd)
  to?: string | null;
  page?: number;
  pageSize?: number;
}

export interface AuditLogPage {
  rows: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;

export function useAuditLog(filters: AuditLogFilters = {}) {
  const page = Math.max(0, filters.page ?? 0);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  return useQuery<AuditLogPage>({
    queryKey: [
      'audit-log',
      {
        action: filters.action ?? null,
        entityType: filters.entityType ?? null,
        userEmail: (filters.userEmail ?? '').trim().toLowerCase(),
        from: filters.from ?? null,
        to: filters.to ?? null,
        page,
        pageSize,
      },
    ],
    queryFn: async () => {
      let q = supabase
        .from('audit_log')
        .select('id, user_id, user_email, action, entity_type, entity_id, metadata, created_at', {
          count: 'exact',
        })
        .order('created_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (filters.action) {
        if (filters.action.endsWith('.')) {
          q = q.like('action', `${filters.action}%`);
        } else {
          q = q.eq('action', filters.action);
        }
      }
      if (filters.entityType) q = q.eq('entity_type', filters.entityType);
      if (filters.userEmail) {
        q = q.ilike('user_email', `%${filters.userEmail.trim()}%`);
      }
      if (filters.from) q = q.gte('created_at', `${filters.from}T00:00:00.000Z`);
      if (filters.to) q = q.lte('created_at', `${filters.to}T23:59:59.999Z`);

      const { data, error, count } = await q;
      if (error) throw error;
      return {
        rows: (data ?? []) as AuditLog[],
        total: count ?? 0,
        page,
        pageSize,
      };
    },
    staleTime: 30_000,
  });
}

// Pobranie większego batcha do raportu PDF (bez paginacji UI)
export async function fetchAuditLogForReport(filters: AuditLogFilters): Promise<AuditLog[]> {
  let q = supabase
    .from('audit_log')
    .select('id, user_id, user_email, action, entity_type, entity_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);

  if (filters.action) {
    if (filters.action.endsWith('.')) q = q.like('action', `${filters.action}%`);
    else q = q.eq('action', filters.action);
  }
  if (filters.entityType) q = q.eq('entity_type', filters.entityType);
  if (filters.userEmail) q = q.ilike('user_email', `%${filters.userEmail.trim()}%`);
  if (filters.from) q = q.gte('created_at', `${filters.from}T00:00:00.000Z`);
  if (filters.to) q = q.lte('created_at', `${filters.to}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditLog[];
}
