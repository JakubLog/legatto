import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { FileText, Newspaper, Plus } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { EmptyState, ErrorNotice, LIST_PANEL, LIST_ROW, ListSkeleton, SettingsCardSkeleton, StatusPill } from '@/components/admin/AdminUi';
import { PostEditor } from '@/components/admin/blog/PostEditor';
import { POST_STATUS_LABEL, POST_STATUS_TONE } from '@/components/admin/blog/postForm';
import { Button } from '@/components/ui/button';
import { postCoverUrl, usePost, usePosts, type PostSummary } from '@/hooks/usePosts';
import { usePublicSiteUrl } from '@/hooks/useSitePublish';
import { plural } from '@/components/public/publicFormat';

const NEW_POST = 'nowy';
const PARAM = 'wpis';

function PostRow({ post, onOpen }: { post: PostSummary; onOpen: () => void }) {
  const cover = postCoverUrl(post.cover_path);
  const when = post.status === 'published' && post.published_at ? post.published_at : post.updated_at;
  const future = post.status === 'published' && post.published_at && new Date(post.published_at) > new Date();
  return (
    <button type="button" onClick={onOpen} className={`${LIST_ROW} w-full text-left`}>
      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <FileText className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{post.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {post.status === 'published' ? (future ? 'Publikacja ' : 'Opublikowano ') : 'Zmieniono '}
          {format(new Date(when), 'd MMM yyyy, HH:mm', { locale: pl })} · {post.slug}
        </p>
      </div>
      <StatusPill tone={future ? 'info' : POST_STATUS_TONE[post.status]}>
        {future ? 'Zaplanowany' : POST_STATUS_LABEL[post.status]}
      </StatusPill>
    </button>
  );
}

/** Blog posła (A12): lista wpisów i edytor - Poseł i Administrator. */
export default function AdminBlog() {
  const [params, setParams] = useSearchParams();
  const selected = params.get(PARAM);
  const editingId = selected && selected !== NEW_POST ? selected : null;
  const postsQ = usePosts();
  const postQ = usePost(editingId);
  const publicSiteUrl = usePublicSiteUrl().data ?? '';

  const open = (value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(PARAM, value);
        else next.delete(PARAM);
        return next;
      },
      { replace: value === null },
    );

  const posts = postsQ.data ?? [];

  if (selected) {
    return (
      <Page narrow>
        {selected === NEW_POST ? (
          <PostEditor key={NEW_POST} post={null} onClose={() => open(null)} onCreated={(post) => open(post.id)} />
        ) : postQ.error ? (
          <ErrorNotice title="Nie udało się wczytać wpisu" message={postQ.error.message} />
        ) : postQ.data ? (
          <PostEditor key={postQ.data.id} post={postQ.data} onClose={() => open(null)} onCreated={(post) => open(post.id)} />
        ) : (
          <div className="space-y-4">
            <SettingsCardSkeleton label="Wczytuję wpis..." fields={4} />
            <SettingsCardSkeleton label="Wczytuję wpis..." fields={2} />
          </div>
        )}
      </Page>
    );
  }

  return (
    <Page narrow>
      <PageHeader
        icon={Newspaper}
        title="Blog"
        description={
          postsQ.isLoading
            ? 'Wczytywanie...'
            : `${posts.length} ${plural(posts.length, 'wpis', 'wpisy', 'wpisów')}${
                publicSiteUrl ? ' · opublikowane wpisy trafiają na stronę posła przy publikacji strony' : ''
              }`
        }
        actions={
          <Button onClick={() => open(NEW_POST)}>
            <Plus className="h-4 w-4" />
            Nowy wpis
          </Button>
        }
      />

      {postsQ.error && <ErrorNotice title="Nie udało się pobrać wpisów" message={postsQ.error.message} />}

      <div className={LIST_PANEL}>
        {postsQ.isLoading && <ListSkeleton rows={4} />}
        {posts.map((post) => (
          <PostRow key={post.id} post={post} onOpen={() => open(post.id)} />
        ))}
        {!postsQ.isLoading && !postsQ.error && posts.length === 0 && (
          <EmptyState
            icon={Newspaper}
            title="Brak wpisów. Pierwszy wpis pojawi się na stronie posła po opublikowaniu."
            action={
              <Button variant="outline" onClick={() => open(NEW_POST)}>
                <Plus className="h-4 w-4" />
                Napisz pierwszy wpis
              </Button>
            }
          />
        )}
      </div>
    </Page>
  );
}
