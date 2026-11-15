import { useLayoutEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PoliAIConversation } from '@/hooks/usePoliAI';
import { buildTurnView, groupTurns, indexToolResults, toolUses, type TurnExtras } from '@/lib/poliai';
import { PoliAIApproval } from './PoliAIApproval';
import { PoliAITurn } from './PoliAITurn';

const STOP_NOTES: Record<string, string> = {
  max_tokens: 'Odpowiedź przerwana - przekroczono limit długości.',
  max_iterations: 'PoliAI przerwał po wielu krokach - napisz, czy kontynuować.',
  refusal: 'PoliAI odmówił odpowiedzi na to polecenie.',
};

const EMPTY_EXTRAS: TurnExtras = { intro: '', introDone: true, actions: [] };

// Odległość od dołu (px), przy której lista dalej „przykleja się” do nowych treści.
const STICK_THRESHOLD = 48;

interface PoliAIMessageListProps {
  conversation: PoliAIConversation;
  onNavigate: (href: string) => void;
}

export function PoliAIMessageList({ conversation, onNavigate }: PoliAIMessageListProps) {
  const { messages, draft, status, runningToolIds, pendingApprovalIds, error, lastStopReason, extras, activeTurn, streamed } =
    conversation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const turns = useMemo(() => groupTurns(messages), [messages]);
  const results = useMemo(() => indexToolResults(messages), [messages]);
  const live = status === 'streaming';

  const pendingUses = useMemo(() => {
    const last = messages[messages.length - 1];
    if (status !== 'awaiting_approval' || last?.role !== 'assistant') return [];
    return toolUses(last).filter((u) => pendingApprovalIds.includes(u.id));
  }, [messages, pendingApprovalIds, status]);

  // Nowa wiadomość użytkownika zawsze przewija na dół.
  const turnCount = turns.length;
  useLayoutEffect(() => {
    stickRef.current = true;
  }, [turnCount]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };

  const stopNote = status === 'idle' && lastStopReason ? STOP_NOTES[lastStopReason] : undefined;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 space-y-10 overflow-y-auto px-5 py-8 md:px-8 lg:px-10"
      aria-live="polite"
      aria-busy={live}
    >
      {turns.map((turn, i) => {
        const isLast = i === turns.length - 1;
        const isLiveTurn = isLast && live;
        const view = buildTurnView(turn, {
          results,
          draft: isLast ? draft : [],
          live: isLiveTurn,
          runningIds: runningToolIds,
          pendingIds: pendingApprovalIds,
        });
        const turnExtras = extras[turn.key] ?? EMPTY_EXTRAS;
        return (
          <PoliAITurn
            key={turn.key}
            userText={turn.userText}
            attachments={turn.attachments}
            view={view}
            live={isLiveTurn}
            animate={streamed && turn.key === activeTurn}
            intro={turnExtras.intro}
            introDone={turnExtras.introDone}
            actions={turnExtras.actions}
            showActions={isLast && status === 'idle'}
            onSend={conversation.send}
            onNavigate={onNavigate}
          >
            {isLast && pendingUses.length > 0 && (
              <PoliAIApproval key={pendingUses.map((u) => u.id).join()} uses={pendingUses} onDecide={conversation.approve} />
            )}
            {isLast && stopNote && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" aria-hidden />
                {stopNote}
              </p>
            )}
            {isLast && status === 'error' && error && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {error.message}
                </p>
                {error.code !== 'AI_NOT_CONFIGURED' && error.code !== 'POLIAI_DAILY_LIMIT' && (
                  <Button type="button" variant="outline" size="sm" onClick={conversation.retry} className="mt-2">
                    <RotateCcw />
                    Spróbuj ponownie
                  </Button>
                )}
              </div>
            )}
          </PoliAITurn>
        );
      })}
    </div>
  );
}
