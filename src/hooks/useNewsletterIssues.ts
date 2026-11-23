import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { NewsletterTemplate } from '@/lib/newsletter/types';

// Wydania newslettera (tabela newsletter_issues, migracja 20261023150000_newsletter_issues.sql):
// wersja online pod /n/<slug> + archiwum treści do duplikowania.
//
// Strona posła (app_settings.public_site_url, migracja 20261121220000_site_publish.sql): wersję online
// serwuje statyczna strona posła, więc przed wysyłką docelową wydanie trzeba na niej opublikować
// (request_newsletter_publication -> job publikacji -> web_published_at). Od zgłoszenia treść wydania
// jest zamrożona (trigger newsletter_issues_freeze_published) - zmiany wymagają nowego wydania.

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

/**
 * Publiczny adres wersji online: strona posła (public_site_url) albo origin portalu
 * (rewrite /n/:slug -> api/newsletter-view, tryb Vercel).
 */
export const newsletterWebUrl = (slug: string, publicSiteUrl: string) =>
  `${publicSiteUrl ? publicSiteUrl.replace(/\/+$/, '') : window.location.origin}/n/${slug}`;

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

/** Wydanie zgłoszone do publikacji na stronie posła ma zamrożoną treść - zmiany tylko w nowym wydaniu. */
export class NewsletterIssueFrozenError extends Error {
  constructor() {
    super('To wydanie zostało już zgłoszone do publikacji na stronie posła i nie można zmienić jego treści.');
    this.name = 'NewsletterIssueFrozenError';
  }
}

/**
 * Zapisuje (albo nadpisuje) szkic wydania przed wysyłką testową / docelową.
 * Szkic zmienia tylko autor albo zarządzający newsletterem (RLS, can_manage_newsletters).
 * Jeśli wskazane wydanie nie jest już szkicem (wysyłane / wysłane) albo RLS nie pozwala go
 * zmienić - tworzy nowe. Szkic zgłoszony do publikacji: ta sama treść = bez zapisu, inna =
 * NewsletterIssueFrozenError (edytor proponuje duplikat jako nowe wydanie).
 */
export function useSaveNewsletterIssue() {
  return useMutation<SavedIssue, Error, SaveIssueInput>({
    mutationFn: async ({ id, subject, template, html_web }) => {
      const row = { subject, template, html_web };
      if (id) {
        const { data: current, error: readError } = await supabase
          .from('newsletter_issues')
          .select('id, slug, status, subject, html_web, web_publish_requested_at')
          .eq('id', id)
          .maybeSingle();
        if (readError) throw readError;
        if (current?.status === 'draft' && current.web_publish_requested_at) {
          if (current.subject === subject && current.html_web === html_web) {
            return { id: current.id, slug: current.slug } as SavedIssue;
          }
          throw new NewsletterIssueFrozenError();
        }
        if (current?.status === 'draft') {
          const { data, error } = await supabase
            .from('newsletter_issues')
            .update(row)
            .eq('id', id)
            .eq('status', 'draft')
            .select('id, slug')
            .maybeSingle();
          if (error) {
            // Wyścig ze zgłoszeniem publikacji w innej karcie: trigger zamrożenia (42501).
            if (error.code === '42501') throw new NewsletterIssueFrozenError();
            throw error;
          }
          if (data) return data as SavedIssue;
        }
      }
      const { data, error } = await supabase.from('newsletter_issues').insert(row).select('id, slug').single();
      if (error) throw error;
      return data as SavedIssue;
    },
  });
}

// ============================================================================
// Publikacja wersji online na stronie posła (przed wysyłką docelową)
// ============================================================================

export type NewsletterPublicationPhase = 'requesting' | 'queued' | 'running';

export class NewsletterPublicationCancelledError extends Error {
  constructor() {
    super('Oczekiwanie na publikację anulowane');
    this.name = 'NewsletterPublicationCancelledError';
  }
}

const PUBLICATION_POLL_MS = 4_000;

/** Kody błędów generatora (service_site_publisher_finish.p_error). */
const PUBLISH_ERROR_LABEL: Record<string, string> = {
  timeout: 'przekroczony czas publikacji',
  failed: 'błąd publikacji',
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new NewsletterPublicationCancelledError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new NewsletterPublicationCancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestPublication(issueId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('request_newsletter_publication', { p_issue_id: issueId });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}

/**
 * Zgłasza wydanie do publikacji na stronie posła i czeka, aż job publikacji je opublikuje
 * (newsletter_issues.web_published_at). Odpytuje wydanie i job; błąd joba = wyjątek z kodem.
 * Anulowanie przerywa tylko oczekiwanie - zgłoszona publikacja i tak się wykona.
 */
export function useNewsletterWebPublication() {
  const [phase, setPhase] = useState<NewsletterPublicationPhase | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const publish = useCallback(async (issueId: string): Promise<void> => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setPhase('requesting');
    try {
      let jobId = await requestPublication(issueId);
      let requeued = false;
      for (;;) {
        if (signal.aborted) throw new NewsletterPublicationCancelledError();
        const { data: issue, error: issueError } = await supabase
          .from('newsletter_issues')
          .select('web_published_at')
          .eq('id', issueId)
          .maybeSingle();
        if (issueError) throw issueError;
        if (!issue) throw new Error('Nie znaleziono wydania newslettera');
        if (issue.web_published_at) return;

        if (jobId) {
          const { data: job, error: jobError } = await supabase
            .from('site_publish_jobs')
            .select('status, error')
            .eq('id', jobId)
            .maybeSingle();
          if (jobError) throw jobError;
          if (job?.status === 'failed') {
            const code = typeof job.error === 'string' ? job.error : 'failed';
            throw new Error(
              `Publikacja strony nie powiodła się (${PUBLISH_ERROR_LABEL[code] ?? `kod: ${code}`}). Spróbuj ponownie później.`,
            );
          }
          if (job?.status === 'running' || job?.status === 'queued') {
            setPhase(job.status);
          } else if (!requeued) {
            // Job zakończony bez tego wydania (zgłoszenie po starcie joba) - jedno ponowne zgłoszenie.
            requeued = true;
            jobId = await requestPublication(issueId);
          } else {
            throw new Error('Publikacja strony zakończyła się bez tego wydania. Spróbuj wysłać ponownie.');
          }
        } else {
          setPhase('queued');
        }
        await sleep(PUBLICATION_POLL_MS, signal);
      }
    } catch (err) {
      if (signal.aborted) throw new NewsletterPublicationCancelledError();
      throw err;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPhase(null);
    }
  }, []);

  return { phase, publish, cancel };
}
