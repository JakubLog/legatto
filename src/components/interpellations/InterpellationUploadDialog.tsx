import { useMemo, useRef, useState, type FormEvent } from 'react';
import { FileUp, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useResubmitInterpellation, useSubmitInterpellation } from '@/hooks/useInterpellations';
import { errorMessage } from '@/lib/errors';
import type { Interpellation } from '@/integrations/supabase/types';

// Limit serwera: 500 000 znaków HTML (api/_lib/tools/interpellations.ts → MAX_HTML_LENGTH).
const MAX_FILE_BYTES = 500_000;

/** Tekst z pola formularza jako HTML: akapity po pustej linii, pojedyncze nowe linie jako <br>. */
function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escape(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/**
 * Plik HTML jako tekst: UTF-8, a gdy plik nim nie jest - kodowanie z `<meta charset>` albo windows-1250
 * (typowy eksport z Worda). `null` = nie da się odczytać bez utraty znaków.
 */
async function readHtmlFile(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Nie UTF-8 - próbujemy kodowania z pliku, potem windows-1250.
  }
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096));
  const declared = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1];
  for (const label of [declared, 'windows-1250']) {
    if (!label) continue;
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      // Nieznana etykieta albo bajty spoza kodowania.
    }
  }
  return null;
}

type Revise = Pick<Interpellation, 'id' | 'recipient' | 'subject' | 'content_text' | 'content_html'>;
type UploadInput = { recipient: string; subject: string; html: string };

interface Props {
  open: boolean;
  /** Brak = nowa interpelacja; podana = poprawiona wersja po uwagach. */
  revise?: Revise | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

/**
 * Ręczne wgranie interpelacji przez Pracownika - działa bez AI. Treść jako tekst albo plik HTML;
 * serwer czyści HTML tak samo jak przy wgraniu przez MCP.
 */
export function InterpellationUploadDialog({ open, revise, onClose, onSaved }: Props) {
  const submitMut = useSubmitInterpellation();
  const resubmitMut = useResubmitInterpellation();
  const pending = submitMut.isPending || resubmitMut.isPending;

  const save = async (input: UploadInput) => {
    try {
      const id = revise
        ? await resubmitMut.mutateAsync({ ...input, id: revise.id })
        : await submitMut.mutateAsync(input);
      toast.success(revise ? 'Poprawiona wersja wgrana' : 'Interpelacja dodana');
      onSaved?.(id);
      onClose();
    } catch (err) {
      toast.error(revise ? 'Nie udało się wgrać poprawionej wersji' : 'Nie udało się dodać interpelacji', {
        description: errorMessage(err),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {/* Treść dialogu montuje się przy otwarciu: formularz startuje od danych interpelacji, a odświeżenie
            danych w tle (realtime) nie kasuje wpisanego tekstu. */}
        <UploadForm revise={revise ?? null} pending={pending} onCancel={onClose} onSave={save} />
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  revise: Revise | null;
  pending: boolean;
  onCancel: () => void;
  onSave: (input: UploadInput) => Promise<void>;
}

function UploadForm({ revise, pending, onCancel, onSave }: FormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [recipient, setRecipient] = useState(revise?.recipient ?? '');
  const [subject, setSubject] = useState(revise?.subject ?? '');
  const [text, setText] = useState(revise?.content_text ?? '');
  const [file, setFile] = useState<{ name: string; html: string } | null>(null);

  const loadFile = async (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) {
      toast.error('Plik jest za duży', { description: 'Maksymalnie 500 KB HTML.' });
      return;
    }
    const content = await readHtmlFile(picked);
    if (content === null) {
      toast.error('Nie udało się odczytać pliku', {
        description: 'Zapisz plik jako HTML w kodowaniu UTF-8 i wczytaj ponownie.',
      });
      return;
    }
    setFile({ name: picked.name, html: content });
  };

  // Podgląd tekstu z pliku przed zapisem (DOMParser nie wykonuje skryptów ani nie ładuje obrazów).
  const filePreview = useMemo(
    () =>
      file
        ? (new DOMParser().parseFromString(file.html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)
        : '',
    [file],
  );
  // Poprawka musi zmieniać treść (trigger interpellations_workflow).
  const unchanged = revise !== null && !file && text === revise.content_text;
  // Pole tekstowe spłaszcza strukturę HTML poprzedniej wersji (nagłówki, listy, tabele).
  const losesStructure = revise !== null && !file && /<(h[1-6]|ul|ol|table)\b/i.test(revise.content_html);

  const html = file ? file.html : textToHtml(text);
  const canSave = recipient.trim() !== '' && subject.trim() !== '' && html.trim() !== '' && !unchanged && !pending;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave) void onSave({ recipient: recipient.trim(), subject: subject.trim(), html });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{revise ? 'Wgraj poprawioną wersję' : 'Nowa interpelacja'}</DialogTitle>
        <DialogDescription>
          {revise
            ? 'Nowa wersja zastępuje treść i wraca do decyzji.'
            : 'Interpelacja trafi do decyzji ze statusem „Nowa”.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="interp-recipient">Odbiorca</Label>
          <Input
            id="interp-recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            maxLength={200}
            placeholder="np. Minister Zdrowia"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="interp-subject">Temat</Label>
          <Input
            id="interp-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="interp-text">Treść</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            className="hidden"
            onChange={(e) => {
              void loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={pending}>
            <FileUp />
            Wczytaj plik HTML
          </Button>
        </div>
        {file ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{file.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFile(null)} disabled={pending}>
                <X />
                Usuń plik
              </Button>
            </div>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {filePreview || 'Plik nie zawiera tekstu.'}
            </p>
          </div>
        ) : (
          <Textarea
            id="interp-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder="Treść interpelacji. Pusta linia rozdziela akapity."
          />
        )}
        {losesStructure && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Poprzednia wersja ma nagłówki, listy lub tabele - pole tekstowe ich nie zachowa. Aby zachować formatowanie,
            wczytaj poprawiony plik HTML.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {unchanged
            ? 'Zmień treść, aby wgrać nową wersję.'
            : 'Z pliku HTML zostaje struktura (akapity, nagłówki, listy, tabele, linki); style i skrypty są usuwane.'}
        </p>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Anuluj
        </Button>
        <Button type="submit" disabled={!canSave}>
          {pending ? <Loader2 className="animate-spin" /> : <Upload />}
          {revise ? 'Wgraj wersję' : 'Dodaj interpelację'}
        </Button>
      </DialogFooter>
    </form>
  );
}
