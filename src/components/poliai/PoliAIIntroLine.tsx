import { isWhitespace, splitWords } from './streamFade';

interface PoliAIIntroLineProps {
  /** Odsłonięta część wstępu (useSmoothText w PoliAITurn). */
  text: string;
  /** Wstęp wciąż się pisze - migający kursor na końcu. */
  streaming: boolean;
}

/** Krótki wstęp szybkiego modelu - pierwszy etap kaskady odpowiedzi, słowa wjeżdżają z fade-in. */
export function PoliAIIntroLine({ text, streaming }: PoliAIIntroLineProps) {
  return (
    <p className="text-sm leading-relaxed text-foreground">
      {splitWords(text).map((part, i) =>
        isWhitespace(part) ? (
          part
        ) : (
          <span key={i} className="poliai-fade">
            {part}
          </span>
        ),
      )}
      {streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary/60 align-middle" aria-hidden />
      )}
    </p>
  );
}
