import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { useAddCaseComment, useCaseMentionableUserIds } from '@/hooks/useCaseHistory';
import { useAssignableUsers } from '@/hooks/useUsers';
import { CASE_COMMENT_MAX, foldForSearch, mentionQueryAt } from '@/lib/caseHistory';
import { cn } from '@/lib/utils';

interface Props {
  caseId: string;
  /** Po wysłaniu (panel przewija oś czasu na dół). */
  onSent?: () => void;
}

const MAX_OPTIONS = 6;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Pole komentarza z @wzmiankami: `@` otwiera listę osób widzących sprawę (filtr wpisywanym tekstem,
 * strzałki / Enter / Tab / Esc), Ctrl/⌘+Enter wysyła. Wzmianki = osoby, których `@Imię Nazwisko`
 * zostało w treści; baza i tak je czyści (bez siebie, tylko widzący sprawę).
 * Esc przy otwartej liście nie zamyka okna: DialogContent sprawdza `data-mention-open`.
 */
export function CaseCommentComposer({ caseId, onSent }: Props) {
  const { profile } = useAuth();
  const { data: users = [] } = useAssignableUsers();
  const { data: mentionable } = useCaseMentionableUserIds(caseId);
  const addMut = useAddCaseComment();
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [body, setBody] = useState('');
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  // Auto-wysokość: od 2 do ok. 8 linii, dalej przewijanie w polu.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [body]);

  const candidates = useMemo(
    () => users.filter((u) => u.id !== profile?.id && (!mentionable || mentionable.has(u.id))),
    [users, mentionable, profile?.id],
  );

  const options = useMemo(() => {
    if (!mention) return [];
    const q = foldForSearch(mention.query);
    return candidates.filter((u) => foldForSearch(u.full_name).includes(q)).slice(0, MAX_OPTIONS);
  }, [mention, candidates]);

  const shownMention = mention && mention.start !== dismissedAt ? mention : null;
  const pickerOpen = shownMention !== null && options.length > 0;
  const trimmed = body.trim();
  const tooLong = trimmed.length > CASE_COMMENT_MAX;

  const syncMention = (text: string, caret: number | null) => {
    const next = caret === null ? null : mentionQueryAt(text, caret);
    setMention(next);
    if (!next || next.query !== mention?.query) setActive(0);
    if (!next) setDismissedAt(null);
  };

  const pick = (name: string) => {
    const el = textareaRef.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? body.length;
    const insert = `@${name} `;
    const next = body.slice(0, mention.start) + insert + body.slice(caret);
    const pos = mention.start + insert.length;
    setBody(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    if (!trimmed || tooLong || addMut.isPending) return;
    const mentions = candidates.filter((u) => trimmed.includes(`@${u.full_name}`)).map((u) => u.id);
    try {
      await addMut.mutateAsync({ caseId, body: trimmed, mentions });
      setBody('');
      setMention(null);
      onSent?.();
    } catch (err) {
      toast.error('Nie udało się dodać komentarza', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + options.length) % options.length);
        return;
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(options[Math.min(active, options.length - 1)].full_name);
        return;
      }
    }
    if (shownMention && e.key === 'Escape') {
      e.preventDefault();
      setDismissedAt(shownMention.start);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const activeOptionId = pickerOpen ? `${listId}-opt-${Math.min(active, options.length - 1)}` : undefined;

  return (
    <div className="relative">
      {shownMention && (shownMention.query.length > 0 || options.length > 0) && (
        <div
          className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-popover"
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Oznacz osobę" className="max-h-60 overflow-y-auto p-1">
              {options.map((u, i) => (
                <li
                  key={u.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm md:min-h-9',
                    i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(u.full_name)}
                >
                  <CreatorAvatar name={u.full_name} avatarUrl={u.avatar_url} className="h-6 w-6 ring-0" />
                  <span className="min-w-0 flex-1 truncate">{u.full_name}</span>
                  {u.office_name && <span className="truncate text-xs text-muted-foreground">{u.office_name}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">Brak pasujących osób z dostępem do tej sprawy.</p>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={body}
          rows={2}
          placeholder="Napisz komentarz…"
          aria-label="Komentarz"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? listId : undefined}
          aria-activedescendant={activeOptionId}
          data-mention-open={shownMention ? 'true' : undefined}
          className="max-h-[200px] min-h-[44px] resize-none"
          onChange={(e) => {
            setBody(e.target.value);
            syncMention(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setMention(null)}
          onKeyDown={handleKeyDown}
        />
        <Button
          type="button"
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={!trimmed || tooLong || addMut.isPending}
          onClick={() => void submit()}
          aria-label="Wyślij komentarz"
          title={`Wyślij (${IS_MAC ? '⌘' : 'Ctrl'}+Enter)`}
        >
          {addMut.isPending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="max-md:hidden">{IS_MAC ? '⌘' : 'Ctrl'}+Enter wysyła · @ oznacza osobę</span>
        <span className="md:hidden">@ oznacza osobę</span>
        {trimmed.length > CASE_COMMENT_MAX - 500 && (
          <span className={cn('tabular-nums', tooLong && 'font-medium text-destructive')}>
            {trimmed.length}/{CASE_COMMENT_MAX}
          </span>
        )}
      </div>
    </div>
  );
}
