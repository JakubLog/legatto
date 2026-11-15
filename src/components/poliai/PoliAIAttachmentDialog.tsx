import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { POLIAI_ATTACHMENTS_BUCKET, type AttachmentBlock } from '@/lib/poliai';
import { attachmentMeta } from '@/lib/poliaiFiles';

const PageSchema = z.object({
  path: z.string().nullable(),
  text: z.string(),
  source: z.enum(['pdf', 'ocr', 'file']),
});
const RowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['image', 'pdf', 'docx', 'text']),
  mime: z.string(),
  stored_size: z.number(),
  pages: z.array(PageSchema),
});

const SOURCE_LABELS: Record<z.infer<typeof PageSchema>['source'], string> = {
  pdf: 'Tekst z PDF',
  ocr: 'Odczyt OCR',
  file: 'Treść pliku',
};

/** Linki do obrazów stron ważne 10 min; dane w cache krócej, żeby nie pokazać wygasłego linku. */
const SIGNED_URL_TTL_S = 600;

async function loadAttachment(id: string) {
  const { data, error } = await supabase
    .from('poliai_attachments')
    .select('id, name, kind, mime, stored_size, pages')
    .eq('id', id)
    .single();
  if (error) throw error;
  const row = RowSchema.parse(data);
  const paths = row.pages.flatMap((page) => (page.path ? [page.path] : []));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(POLIAI_ATTACHMENTS_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_S);
    if (signError) throw signError;
    for (const entry of signed) {
      if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
    }
  }
  return { row, urls };
}

interface PoliAIAttachmentDialogProps {
  attachment: AttachmentBlock | null;
  onClose: () => void;
}

/** Podgląd „co widzi PoliAI”: obrazy stron i tekst każdej strony (warstwa PDF, OCR albo treść pliku). */
export function PoliAIAttachmentDialog({ attachment, onClose }: PoliAIAttachmentDialogProps) {
  const id = attachment?.id;
  const query = useQuery({
    queryKey: ['poliai-attachment', id],
    enabled: Boolean(id),
    staleTime: (SIGNED_URL_TTL_S - 60) * 1000,
    gcTime: (SIGNED_URL_TTL_S - 60) * 1000,
    queryFn: () => loadAttachment(id as string),
  });
  const pages = query.data?.row.pages ?? [];

  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(o) => !o && onClose()}>
      {attachment && (
        <DialogContent className="max-h-[92vh] gap-5 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="break-words leading-snug">{attachment.name}</DialogTitle>
            <DialogDescription>Co widzi PoliAI · {attachmentMeta(attachment)}</DialogDescription>
          </DialogHeader>
          {query.isPending ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Wczytywanie załącznika…
            </div>
          ) : query.isError ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Nie udało się wczytać załącznika. Mógł zostać usunięty razem z rozmową.
            </p>
          ) : (
            <div className="space-y-6">
              {pages.map((page, i) => {
                const url = page.path ? query.data?.urls[page.path] : undefined;
                const text = page.text.trim();
                return (
                  <section key={page.path ?? i} className="space-y-2">
                    {pages.length > 1 && <h3 className="text-xs font-medium text-muted-foreground">Strona {i + 1}</h3>}
                    {page.path &&
                      (url ? (
                        <img
                          src={url}
                          alt={pages.length > 1 ? `${attachment.name} - strona ${i + 1}` : attachment.name}
                          loading="lazy"
                          className="max-w-full rounded-lg border"
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">Obraz strony jest niedostępny.</p>
                      ))}
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {text ? SOURCE_LABELS[page.source] : 'Brak tekstu'}
                      </p>
                      {text && (
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 font-sans text-xs leading-relaxed">
                          {text}
                        </pre>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
