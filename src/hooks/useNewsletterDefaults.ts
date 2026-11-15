import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NewsletterDefaults {
  header_avatar_url: string;
  /** Region w nagłówku i etykieta sekcji regionalnej (np. "Mazowsze"); pusty = "Z regionu". */
  region_label: string;
  footer_office_name: string;
  footer_office_address: string;
  footer_contact_email: string;
  footer_privacy_url: string;
  footer_social_x: string;
  footer_social_facebook: string;
  footer_social_instagram: string;
  footer_social_tiktok: string;
  footer_social_youtube: string;
}

// Neutralne - dane konkretnego posła są w app_settings.newsletter_defaults (panel admina).
export const EMPTY_NEWSLETTER_DEFAULTS: NewsletterDefaults = {
  header_avatar_url: '',
  region_label: '',
  footer_office_name: '',
  footer_office_address: '',
  footer_contact_email: '',
  footer_privacy_url: '',
  footer_social_x: '',
  footer_social_facebook: '',
  footer_social_instagram: '',
  footer_social_tiktok: '',
  footer_social_youtube: '',
};

export function useNewsletterDefaults() {
  return useQuery<NewsletterDefaults>({
    queryKey: ['newsletter-defaults'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'newsletter_defaults')
        .single();
      if (error) throw error;
      const raw = (data?.value ?? {}) as Partial<NewsletterDefaults>;
      return { ...EMPTY_NEWSLETTER_DEFAULTS, ...raw };
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateNewsletterDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (defaults: NewsletterDefaults) => {
      const { error } = await supabase
        .from('app_settings')
        .update({ value: defaults as unknown as Record<string, unknown> })
        .eq('key', 'newsletter_defaults');
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['newsletter-defaults'] });
    },
  });
}
