import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { uploadSiteAsset } from '@/hooks/useSiteContent';
import type { PostStatus } from '@/components/admin/blog/postForm';

// Blog posła (A12, tabela public.posts - migracja 20261121210000_posts.sql).
// Dostęp: Poseł/Administrator + aal2 (RLS), zmiany audytuje trigger posts_audit.
// Na stronę posła trafiają tylko wpisy 'published' z published_at <= now() - przy publikacji strony
// (service_site_snapshot). Okładka: ścieżka w buckecie site-assets (blog/<plik>).

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_path: string;
  status: PostStatus;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PostSummary = Omit<Post, 'body_md'>;

export interface PostInput {
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_path: string;
  status: PostStatus;
  /** null = przy pierwszej publikacji ustawia baza (now()). */
  published_at: string | null;
}

const POSTS_QUERY_KEY = ['posts'] as const;
const SUMMARY_COLUMNS = 'id, slug, title, excerpt, cover_path, status, published_at, author_id, created_at, updated_at';

/** Komunikat dla typowych błędów zapisu (unikalny slug, CHECK-i tabeli). */
function postErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Wpis o tym adresie już istnieje - zmień adres wpisu';
  if (error.code === '23514') return `Nieprawidłowe dane wpisu (${error.message})`;
  if (error.code === '42501') return 'Brak uprawnień (Poseł/Administrator z 2FA)';
  return error.message;
}

export function usePosts() {
  return useQuery<PostSummary[]>({
    queryKey: POSTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select(SUMMARY_COLUMNS)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as PostSummary[];
    },
  });
}

export function usePost(id: string | null) {
  return useQuery<Post>({
    queryKey: [...POSTS_QUERY_KEY, id],
    queryFn: async () => {
      const { data, error } = await supabase.from('posts').select('*').eq('id', id).single();
      if (error) throw error;
      return data as Post;
    },
    enabled: Boolean(id),
    // Formularz edycji startuje z tych danych - bez odświeżania pod ręką użytkownika.
    staleTime: Infinity,
  });
}

export function useSavePost() {
  const qc = useQueryClient();
  return useMutation<Post, Error, { id: string | null; input: PostInput }>({
    mutationFn: async ({ id, input }) => {
      const query = id
        ? supabase.from('posts').update(input).eq('id', id).select('*').maybeSingle()
        : supabase.from('posts').insert(input).select('*').maybeSingle();
      const { data, error } = await query;
      if (error) throw new Error(postErrorMessage(error));
      // RLS bez uprawnień zwraca 0 wierszy zamiast błędu.
      if (!data) throw new Error(id ? 'Wpis nie istnieje albo brak uprawnień' : 'Brak uprawnień do zapisu wpisu');
      return data as Post;
    },
    onSuccess: (post) => {
      qc.setQueryData([...POSTS_QUERY_KEY, post.id], post);
      void qc.invalidateQueries({ queryKey: POSTS_QUERY_KEY, exact: true });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { data, error } = await supabase.from('posts').delete().eq('id', id).select('id');
      if (error) throw new Error(postErrorMessage(error));
      if (!data?.length) throw new Error('Wpis nie istnieje albo brak uprawnień');
    },
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: [...POSTS_QUERY_KEY, id] });
      void qc.invalidateQueries({ queryKey: POSTS_QUERY_KEY, exact: true });
    },
  });
}

/** Okładka albo zdjęcie do treści wpisu: site-assets/blog/<timestamp>.<ext> (JPG/PNG/WebP, max 5 MB). */
export function useUploadPostImage() {
  return useMutation({ mutationFn: (file: File) => uploadSiteAsset(file, 'blog') });
}

/** Publiczny URL okładki (cover_path w site-assets); '' = brak okładki. */
export function postCoverUrl(coverPath: string): string {
  return coverPath ? supabase.storage.from('site-assets').getPublicUrl(coverPath).data.publicUrl : '';
}
