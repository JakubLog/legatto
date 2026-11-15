import { useState, type ReactNode } from 'react';
import { useSmoothText } from '@/hooks/useSmoothText';
import { getActionIcon, type AttachmentBlock, type SuggestedAction, type TurnView } from '@/lib/poliai';
import { PoliAIAttachmentDialog } from './PoliAIAttachmentDialog';
import { PoliAIAttachmentPill } from './PoliAIAttachmentPill';
import { PoliAIMark } from './PoliAIMark';
import { PoliAIMarkdown } from './PoliAIMarkdown';
import { PoliAIProcess } from './PoliAIProcess';
import { PoliAIIntroLine } from './PoliAIIntroLine';

interface PoliAITurnProps {
  userText: string | null;
  attachments: AttachmentBlock[];
  view: TurnView;
  live: boolean;
  /** Tura strumieniowana w tej sesji - tekst odsłania się płynnie (historia od razu w całości). */
  animate: boolean;
  intro: string;
  /** Wstęp skończony (albo go nie będzie) - dopiero wtedy pokazujemy proces i odpowiedź (kaskada). */
  introDone: boolean;
  actions: SuggestedAction[];
  showActions: boolean;
  onSend: (text: string) => void;
  onNavigate: (href: string) => void;
  children?: ReactNode;
}

function ActionButtons({ actions, onSend, onNavigate }: { actions: SuggestedAction[]; onSend: (text: string) => void; onNavigate: (href: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-1.5" aria-label="Proponowane kolejne kroki">
      {actions.map((action, i) => {
        const Icon = getActionIcon(action);
        return (
          <button
            key={action.label}
            type="button"
            onClick={() => (action.prompt ? onSend(action.prompt) : action.href && onNavigate(action.href))}
            style={{ animationDelay: `${i * 70}ms` }}
            className="group inline-flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-300 max-md:py-2"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Jedna tura rozmowy. Kaskada odpowiedzi: wstęp szybkiego modelu → kafelek pracy (proces) →
 * odpowiedź. Proces, odpowiedź, karta zatwierdzenia i przyciski akcji czekają na koniec wstępu,
 * nawet jeśli dane z głównego modelu przyjdą wcześniej.
 */
export function PoliAITurn({
  userText,
  attachments,
  view,
  live,
  animate,
  intro,
  introDone,
  actions,
  showActions,
  onSend,
  onNavigate,
  children,
}: PoliAITurnProps) {
  const shownIntro = useSmoothText(intro, animate);
  // Kaskada: kafelek pracy i odpowiedź dopiero, gdy wstęp jest w całości na ekranie.
  const introRevealed = introDone && shownIntro.length >= intro.length;
  const [preview, setPreview] = useState<AttachmentBlock | null>(null);

  return (
    <section className="space-y-8">
      {userText !== null && (
        <div className="flex flex-col items-end gap-2">
          {attachments.length > 0 && (
            <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
              {attachments.map((attachment) => (
                <PoliAIAttachmentPill
                  key={attachment.id}
                  name={attachment.name}
                  block={attachment}
                  onOpen={() => setPreview(attachment)}
                />
              ))}
            </div>
          )}
          {userText && (
            <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
              {userText}
            </p>
          )}
        </div>
      )}
      {attachments.length > 0 && <PoliAIAttachmentDialog attachment={preview} onClose={() => setPreview(null)} />}
      <div className="flex gap-3">
        <PoliAIMark animated={live} className="mt-0.5 h-7 w-7 rounded-lg" iconClassName="h-3.5 w-3.5" />
        <div className="min-w-0 flex-1 space-y-4">
          {shownIntro && <PoliAIIntroLine text={shownIntro} streaming={!introRevealed} />}
          {introRevealed && (
            <>
              <PoliAIProcess items={view.process} live={live} />
              {view.answer.map((part) => (
                <PoliAIMarkdown key={part.key} text={part.text} animate={animate} live={part.live} onNavigate={onNavigate} />
              ))}
              {children}
              {showActions && actions.length > 0 && <ActionButtons actions={actions} onSend={onSend} onNavigate={onNavigate} />}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
