import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePoliAIConversation, usePoliAIPanel } from './PoliAIProvider';
import { PoliAIHeader } from './PoliAIHeader';
import { PoliAIEmptyState } from './PoliAIEmptyState';
import { PoliAIMessageList } from './PoliAIMessageList';
import { PoliAIComposer } from './PoliAIComposer';
import { PoliAILoadingState } from './PoliAILoadingState';

interface PoliAIPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Zawartość panelu PoliAI: nagłówek, rozmowa (albo ekran startowy/ładowanie) i pole wpisywania. */
export function PoliAIPanel({ open, onClose }: PoliAIPanelProps) {
  const conversation = usePoliAIConversation();
  const panel = usePoliAIPanel();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { conversationId, title, messages, status, send, reset, open: openConversation } = conversation;

  useEffect(() => {
    if (!open || status === 'loading') return;
    // Po klatce - panel musi być już widoczny (visibility), inaczej focus() nic nie zrobi.
    const frame = requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, status]);

  const setPanelOpen = panel?.setOpen;
  const handleNavigate = useCallback(
    (href: string) => {
      navigate(href);
      if (isMobile) setPanelOpen?.(false);
    },
    [navigate, isMobile, setPanelOpen],
  );

  const handleReset = () => {
    reset();
    composerRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PoliAIHeader
        conversationId={conversationId}
        title={title}
        canReset={messages.length > 0 || status === 'loading'}
        onReset={handleReset}
        onClose={onClose}
        onOpen={openConversation}
      />
      {status === 'loading' ? (
        <PoliAILoadingState />
      ) : messages.length === 0 ? (
        <PoliAIEmptyState onPick={send} />
      ) : (
        <PoliAIMessageList conversation={conversation} onNavigate={handleNavigate} />
      )}
      <PoliAIComposer ref={composerRef} conversation={conversation} />
    </div>
  );
}
