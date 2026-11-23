import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';

import { DangerTitleIcon, SettingsCard, StatusPill } from '@/components/admin/AdminUi';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { postCoverUrl, useDeletePost, useSavePost, useUploadPostImage, type Post } from '@/hooks/usePosts';
import { usePublicSiteUrl, useSitePublishAction } from '@/hooks/useSitePublish';
import { zodFormResolver } from '@/lib/zodForm';

import { BlogMarkdown } from './BlogMarkdown';
import {
  fromDateTimeLocal,
  POST_EXCERPT_MAX,
  POST_STATUS_LABEL,
  POST_STATUS_TONE,
  POST_STATUSES,
  postFormSchema,
  slugify,
  toDateTimeLocal,
  type PostFormValues,
  type PostStatus,
} from './postForm';

const ACCEPT = 'image/jpeg,image/png,image/webp';

const EMPTY_VALUES: PostFormValues = {
  title: '',
  slug: '',
  excerpt: '',
  body_md: '',
  cover_path: '',
  status: 'draft',
  published_at: '',
};

const toFormValues = (post: Post): PostFormValues => ({
  title: post.title,
  slug: post.slug,
  excerpt: post.excerpt,
  body_md: post.body_md,
  cover_path: post.cover_path,
  status: post.status,
  published_at: toDateTimeLocal(post.published_at),
});

interface Props {
  /** Edytowany wpis; null = nowy. */
  post: Post | null;
  onClose: () => void;
  /** Po pierwszym zapisie nowego wpisu (przejście na adres edycji). */
  onCreated: (post: Post) => void;
}

/** Edytor wpisu bloga: tytuł, adres, zajawka, okładka, Markdown z podglądem, status i data publikacji. */
export function PostEditor({ post, onClose, onCreated }: Props) {
  const saveMut = useSavePost();
  const deleteMut = useDeletePost();
  const uploadMut = useUploadPostImage();
  const publicSiteUrl = usePublicSiteUrl().data ?? '';
  const { publish } = useSitePublishAction();

  const form = useForm<PostFormValues>({
    resolver: zodFormResolver(postFormSchema),
    defaultValues: post ? toFormValues(post) : EMPTY_VALUES,
  });
  const { register, control, setValue, formState } = form;
  const { errors, isDirty } = formState;
  const [title, coverPath, status, body, excerpt] = useWatch({
    control,
    name: ['title', 'cover_path', 'status', 'body_md', 'excerpt'],
  });

  // Adres podpowiadany z tytułu, dopóki użytkownik go nie zmieni (istniejący wpis ma już adres).
  const slugTouchedRef = useRef(Boolean(post));
  useEffect(() => {
    if (!slugTouchedRef.current) setValue('slug', slugify(title), { shouldDirty: true });
  }, [title, setValue]);

  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const bodyImageInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [uploadTarget, setUploadTarget] = useState<'cover' | 'body' | null>(null);

  const { ref: bodyRegisterRef, ...bodyRegister } = register('body_md');
  const slugRegister = register('slug');

  const upload = async (file: File, target: 'cover' | 'body') => {
    setUploadTarget(target);
    try {
      const asset = await uploadMut.mutateAsync(file);
      if (target === 'cover') {
        setCoverBroken(false);
        setValue('cover_path', asset.path, { shouldDirty: true });
      } else {
        // Zdjęcie w treści: Markdown z publicznym URL-em Storage w miejscu kursora.
        const el = bodyRef.current;
        const current = form.getValues('body_md');
        const at = el ? el.selectionStart : current.length;
        const snippet = `${at > 0 && !current.slice(0, at).endsWith('\n\n') ? '\n\n' : ''}![Opis zdjęcia](${asset.publicUrl})\n\n`;
        setValue('body_md', current.slice(0, at) + snippet + current.slice(at), { shouldDirty: true, shouldValidate: true });
      }
    } catch (err) {
      toast.error('Nie udało się wgrać zdjęcia', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    } finally {
      setUploadTarget(null);
    }
  };

  const onSubmit = async (values: PostFormValues) => {
    const wasPublished = post?.status === 'published';
    try {
      const saved = await saveMut.mutateAsync({
        id: post?.id ?? null,
        input: {
          title: values.title.trim(),
          slug: values.slug.trim(),
          excerpt: values.excerpt.trim(),
          body_md: values.body_md,
          cover_path: values.cover_path,
          status: values.status,
          published_at: fromDateTimeLocal(values.published_at),
        },
      });
      form.reset(toFormValues(saved));
      slugTouchedRef.current = true;
      // Strona posła jest statyczna: opublikowany (albo zdjęty z publikacji) wpis trafia na nią po publikacji.
      const affectsSite = saved.status === 'published' || wasPublished;
      toast.success('Wpis zapisany', {
        description:
          publicSiteUrl && affectsSite ? 'Opublikuj stronę, aby zmiana pojawiła się na stronie posła.' : undefined,
        action: publicSiteUrl && affectsSite ? { label: 'Opublikuj stronę', onClick: () => void publish() } : undefined,
      });
      if (!post) onCreated(saved);
    } catch (err) {
      toast.error('Nie udało się zapisać wpisu', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    }
  };

  const onInvalid = () => {
    toast.error('Popraw zaznaczone pola', { description: 'Wpis nie został zapisany.' });
  };

  const handleDelete = async () => {
    if (!post) return;
    try {
      await deleteMut.mutateAsync(post.id);
      toast.success('Wpis usunięty', {
        description: publicSiteUrl && post.status === 'published' ? 'Opublikuj stronę, aby zniknął ze strony posła.' : undefined,
        action:
          publicSiteUrl && post.status === 'published'
            ? { label: 'Opublikuj stronę', onClick: () => void publish() }
            : undefined,
      });
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      toast.error('Nie udało się usunąć wpisu', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    }
  };

  const coverUrl = postCoverUrl(coverPath);
  const saving = saveMut.isPending;
  const uploading = uploadMut.isPending;

  return (
    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => (isDirty ? setConfirmLeave(true) : onClose())}
        >
          <ArrowLeft className="h-4 w-4" />
          Wszystkie wpisy
        </Button>
        {post && <StatusPill tone={POST_STATUS_TONE[post.status]}>{POST_STATUS_LABEL[post.status]}</StatusPill>}
      </div>

      <SettingsCard icon={FileText} title={post ? 'Edycja wpisu' : 'Nowy wpis'}>
        <div className="grid gap-3 @md:grid-cols-2">
          <div className="min-w-0 space-y-1.5 @md:col-span-2">
            <Label htmlFor="post-title">Tytuł</Label>
            <Input id="post-title" autoComplete="off" aria-invalid={errors.title ? true : undefined} {...register('title')} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="min-w-0 space-y-1.5 @md:col-span-2">
            <Label htmlFor="post-slug">Adres wpisu</Label>
            <div className="flex gap-2">
              <Input
                id="post-slug"
                autoComplete="off"
                spellCheck={false}
                placeholder="np. spotkanie-z-mieszkancami"
                aria-invalid={errors.slug ? true : undefined}
                {...slugRegister}
                onChange={(e) => {
                  // Puste pole: znów podpowiadamy z tytułu.
                  slugTouchedRef.current = e.target.value.trim() !== '';
                  void slugRegister.onChange(e);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                title="Utwórz adres z tytułu"
                onClick={() => setValue('slug', slugify(form.getValues('title')), { shouldDirty: true, shouldValidate: true })}
              >
                <Wand2 className="h-4 w-4" />
                <span className="@max-sm:sr-only">Z tytułu</span>
              </Button>
            </div>
            {errors.slug ? (
              <p className="text-xs text-destructive">{errors.slug.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Końcówka adresu wpisu na stronie posła. Zmiana adresu opublikowanego wpisu psuje udostępnione linki.
              </p>
            )}
          </div>

          <div className="min-w-0 space-y-1.5 @md:col-span-2">
            <Label htmlFor="post-excerpt">Zajawka</Label>
            <Textarea id="post-excerpt" rows={3} aria-invalid={errors.excerpt ? true : undefined} {...register('excerpt')} />
            {errors.excerpt ? (
              <p className="text-xs text-destructive">{errors.excerpt.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Krótki opis na liście wpisów i w podglądzie linku ({excerpt.length}/{POST_EXCERPT_MAX}).
              </p>
            )}
          </div>

          <div className="min-w-0 space-y-1.5 @md:col-span-2">
            <Label htmlFor="post-cover">Okładka</Label>
            <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start">
              <div className="flex aspect-[16/9] w-full max-w-64 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
                {uploading && uploadTarget === 'cover' ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-label="Wgrywam okładkę" />
                ) : coverUrl && !coverBroken ? (
                  <img src={coverUrl} alt="Podgląd okładki" className="h-full w-full object-cover" onError={() => setCoverBroken(true)} />
                ) : (
                  <ImagePlus className="h-6 w-6" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    id="post-cover"
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => coverInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    {coverPath ? 'Zmień okładkę' : 'Wgraj okładkę'}
                  </Button>
                  {coverPath && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={uploading}
                      onClick={() => setValue('cover_path', '', { shouldDirty: true })}
                    >
                      <Trash2 className="h-4 w-4" />
                      Usuń
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">JPG, PNG lub WebP, do 5 MB. Najlepiej poziome 1200×675 px.</p>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void upload(file, 'cover');
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Pencil}
        title="Treść"
        description="Markdown: **pogrubienie**, *kursywa*, # nagłówki, - listy, [link](https://…), tabele. Kod HTML jest pomijany."
        actions={
          <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Tryb edytora">
            <Button
              type="button"
              size="sm"
              variant={mode === 'write' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'write'}
              onClick={() => setMode('write')}
            >
              <Pencil className="h-4 w-4" />
              Edycja
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'preview' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              <Eye className="h-4 w-4" />
              Podgląd
            </Button>
          </div>
        }
      >
        {mode === 'write' ? (
          <div className="space-y-2">
            <Textarea
              rows={20}
              aria-label="Treść wpisu (Markdown)"
              aria-invalid={errors.body_md ? true : undefined}
              className="min-h-[360px] font-mono text-[13px] leading-relaxed"
              {...bodyRegister}
              ref={(el) => {
                bodyRegisterRef(el);
                bodyRef.current = el;
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {errors.body_md ? (
                <p className="text-xs text-destructive">{errors.body_md.message}</p>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => bodyImageInputRef.current?.click()}
              >
                {uploading && uploadTarget === 'body' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                Wstaw zdjęcie
              </Button>
              <input
                ref={bodyImageInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(file, 'body');
                }}
              />
            </div>
          </div>
        ) : body.trim() ? (
          <BlogMarkdown text={body} className="min-h-[360px]" />
        ) : (
          <p className="text-sm text-muted-foreground">Brak treści do podglądu.</p>
        )}
      </SettingsCard>

      <SettingsCard
        icon={CheckCircle2}
        title="Publikacja"
        description={
          publicSiteUrl
            ? 'Opublikowane wpisy z datą publikacji w przeszłości trafiają na stronę posła przy najbliższej publikacji strony.'
            : 'Opublikowane wpisy z datą publikacji w przeszłości są widoczne na stronie posła.'
        }
      >
        <div className="grid gap-3 @md:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="post-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setValue('status', v as PostStatus, { shouldDirty: true, shouldValidate: true })}
            >
              <SelectTrigger id="post-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POST_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {POST_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Szkic i wpis zarchiwizowany nie są widoczne na stronie.
            </p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="post-published-at">Data publikacji</Label>
            <Input
              id="post-published-at"
              type="datetime-local"
              aria-invalid={errors.published_at ? true : undefined}
              {...register('published_at')}
            />
            {errors.published_at ? (
              <p className="text-xs text-destructive">{errors.published_at.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Puste pole = chwila pierwszej publikacji. Data w przyszłości wstrzymuje wpis do tego dnia.
              </p>
            )}
          </div>
        </div>
      </SettingsCard>

      <div className="sticky bottom-2 z-30 -mx-1 md:bottom-4">
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-card backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" role="status">
            {isDirty || !post ? (
              <>
                <CircleDot className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                {post ? 'Niezapisane zmiany' : 'Nowy wpis - niezapisany'}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                Wszystkie zmiany zapisane
              </>
            )}
          </p>
          <div className="flex shrink-0 gap-2">
            {post && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={saving || deleteMut.isPending}
                onClick={() => setConfirmDelete(true)}
                title="Usuń wpis"
              >
                <Trash2 className="h-4 w-4" />
                <span className="@max-sm:sr-only">Usuń</span>
              </Button>
            )}
            <Button type="submit" disabled={(post !== null && !isDirty) || saving || uploading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Zapisz
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !deleteMut.isPending && setConfirmDelete(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3">
              <DangerTitleIcon icon={Trash2} />
              Usunąć wpis?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Wpis „{post?.title}” zostanie trwale usunięty z CRM. Tej operacji nie da się cofnąć - jeśli chcesz
              tylko zdjąć go ze strony, ustaw status „Zarchiwizowany”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Usuń trwale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Porzucić niezapisane zmiany?</AlertDialogTitle>
            <AlertDialogDescription>Zmiany w tym wpisie nie zostały zapisane.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zostań</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>Porzuć zmiany</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
