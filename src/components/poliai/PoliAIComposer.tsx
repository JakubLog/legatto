import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PoliAIConversation } from '@/hooks/usePoliAI';
import { usePoliAIAttachments } from '@/hooks/usePoliAIAttachments';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ACCEPT } from '@/lib/poliaiFiles';
import { cn } from '@/lib/utils';
import { POLIAI_COMPOSER_ID } from './constants';
import { PoliAIAttachmentPill } from './PoliAIAttachmentPill';

// Maksymalna wysokość pola (~8 linii) - dalej przewijanie wewnątrz.
const MAX_HEIGHT_PX = 200;

interface PoliAIComposerProps {
  conversation: PoliAIConversation;
}

/**
 * Pole wiadomości: Enter wysyła, Shift+Enter nowa linia; w trakcie odpowiedzi przycisk „Zatrzymaj”.
 * Załączniki: spinacz, wklejenie albo upuszczenie plików - pastylki nad polem do czasu wysłania.
 */
export const PoliAIComposer = forwardRef<HTMLTextAreaElement, PoliAIComposerProps>(function PoliAIComposer(
  { conversation },
  ref,
) {
  const [value, setValue] = useState('');
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);
  const attachments = usePoliAIAttachments();
  // Na telefonie długi placeholder był ucinany w połowie słowa - krótsza wersja.
  const isMobile = useIsMobile();

  const streaming = conversation.status === 'streaming';
  const loading = conversation.status === 'loading';
  const hasContent = value.trim().length > 0 || attachments.readyBlocks.length > 0;
  const canSend = hasContent && !attachments.busy && !attachments.hasErrors && !streaming && !loading;

  // Wysokość pola = treść (1 linia, gdy puste - zawinięty placeholder nie powiększa pola).
  // Liczona też przy zmianie szerokości: panel montuje się przy szerokości 0 i rozszerza
  // animacją, więc pomiar tylko przy zmianie wartości zostawiał pole na max wysokości.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = '';
      if (el.value) el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const submit = () => {
    if (!canSend) return;
    conversation.send(value, attachments.readyBlocks);
    setValue('');
    attachments.clear();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // Pliki ze schowka (zrzut ekranu, skopiowany obraz albo plik). Word/Excel kopiują tekst razem
  // z obrazkiem podglądu - wtedy wklejamy tekst.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    const hasText = e.clipboardData.getData('text/plain').trim().length > 0;
    if (hasText && files.every((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    attachments.add(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    attachments.add(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className="shrink-0 bg-card px-5 pb-6 pt-3 md:px-14 md:pb-8"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {attachments.items.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5" aria-label="Załączniki do wysłania">
          {attachments.items.map((item) => (
            <PoliAIAttachmentPill
              key={item.localId}
              name={item.name}
              kind={item.kind}
              block={item.block}
              status={item.status}
              error={item.error}
              onRemove={() => attachments.remove(item.localId)}
            />
          ))}
        </div>
      )}
      {/* Ramka w kolorach AI: gradient granat → bordo przesuwa się (gradient-flow), pod nią rozmyta poświata. */}
      <div className="group relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-[20px] bg-gradient-to-r from-primary via-brand to-primary bg-[length:200%_200%] opacity-15 blur-lg transition-opacity duration-300 group-focus-within:opacity-30 motion-safe:animate-gradient-flow"
        />
        <div
          className={cn(
            'relative rounded-2xl bg-gradient-to-r from-primary/35 via-brand/35 to-primary/35 bg-[length:200%_200%] p-px shadow-[0_10px_28px_-14px_hsl(var(--primary)/0.4)] transition-colors group-focus-within:from-primary/60 group-focus-within:via-brand/60 group-focus-within:to-primary/60 motion-safe:animate-gradient-flow',
            dragging && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-card',
          )}
        >
          <div className="relative rounded-[15px] bg-background">
            <label htmlFor={POLIAI_COMPOSER_ID} className="sr-only">
              Wiadomość do PoliAI
            </label>
            <textarea
              id={POLIAI_COMPOSER_ID}
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              maxLength={8000}
              placeholder={
                conversation.status === 'awaiting_approval'
                  ? isMobile
                    ? 'Zatwierdź albo napisz, co zmienić…'
                    : 'Zatwierdź operację powyżej albo napisz, co zmienić…'
                  : isMobile
                    ? 'Zapytaj PoliAI…'
                    : 'Zapytaj PoliAI o sprawy, kalendarz, interpelacje…'
              }
              className="block max-h-[200px] w-full resize-none bg-transparent py-4 pl-14 pr-14 text-base placeholder:truncate placeholder:text-muted-foreground/80 focus-visible:outline-none md:text-sm"
            />
            <div className="absolute bottom-3 left-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                tabIndex={-1}
                onChange={(e) => {
                  attachments.add(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                aria-label="Dołącz pliki"
                title="Dołącz pliki"
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground max-md:h-9 max-md:w-9"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </div>
            <div className="absolute bottom-3 right-3">
              {streaming ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={conversation.stop}
                  aria-label="Zatrzymaj odpowiedź"
                  className="h-8 w-8 rounded-lg max-md:h-9 max-md:w-9"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label="Wyślij"
                  className={cn('h-8 w-8 rounded-lg max-md:h-9 max-md:w-9', !canSend && 'opacity-40')}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2.5 px-1 text-[11px] text-muted-foreground">
        PoliAI może się mylić. Operacje zapisu wymagają Twojego zatwierdzenia.
      </p>
    </div>
  );
});
