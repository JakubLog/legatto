import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { NewsletterTemplate } from '@/lib/newsletter/types';

// Wydania newslettera (tabela newsletter_issues, migracja 20261023150000_newsletter_issues.sql):
// wersja online pod /n/<slug> + archiwum treści do duplikowania.

export interface NewsletterIssueSummary {
  id: string;
  slug: string;
  subject: string;
  gr_newsletter_id: string | null;
  sent_at: string | null;
}

export interface SavedIssue {
  id: string;
  slug: string;
}

/** Publiczny adres wersji online (rewrite /n/:slug -> api/newsletter-view). */
export const newsletterWebUrl = (slug: string) => `${window.location.origin}/n/${slug}`;

export function useNewsletterIssues(enabled = true) {
  return useQuery<NewsletterIssueSummary[]>({
    queryKey: ['newsletter-issues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('newsletter_issues')
        .select('id, slug, subject, gr_newsletter_id, sent_at')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as NewsletterIssueSummary[];
    },
    enabled,
    staleTime: 60_000,
  });
}

export async function fetchNewsletterIssueTemplate(id: string): Promise<unknown> {
  const { data, error } = await supabase.from('newsletter_issues').select('template').eq('id', id).single();
  if (error) throw error;
  return data.template;
}

interface SaveIssueInput {
  /** Istniejący szkic wydania do nadpisania; null = nowe wydanie. */
  id: string | null;
  subject: string;
  template: NewsletterTemplate;
  html_web: string;
}

/**
 * Zapisuje (albo nadpisuje) szkic wydania przed wysyłką testową / docelową.
 * Szkic zmienia tylko autor albo zarządzający newsletterem (RLS, can_manage_newsletters).
 * Jeśli wskazane wydanie nie jest już szkicem (wysyłane / wysłane) albo RLS nie pozwala go
 * zmienić - tworzy nowe.
 */
export function useSaveNewsletterIssue() {
  return useMutation<SavedIssue, Error, SaveIssueInput>({
    mutationFn: async ({ id, subject, template, html_web }) => {
      const row = { subject, template, html_web };
      if (id) {
        const { data, error } = await supabase
          .from('newsletter_issues')
          .update(row)
          .eq('id', id)
          .eq('status', 'draft')
          .select('id, slug')
          .maybeSingle();
        if (error) throw error;
        if (data) return data as SavedIssue;
      }
      const { data, error } = await supabase.from('newsletter_issues').insert(row).select('id, slug').single();
      if (error) throw error;
      return data as SavedIssue;
    },
  });
}
