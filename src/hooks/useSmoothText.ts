import { useEffect, useRef, useState } from 'react';

/**
 * Płynne odsłanianie strumieniowanego tekstu. API Claude potrafi oddać odpowiedź seriami (np. po
 * podsumowaniu myślenia cały akapit naraz) - tu tekst wysuwa się klatka po klatce, z tempem
 * zależnym od zaległości: duża paczka dogania w ~1-2 s, pojedyncze słowa pojawiają się od razu.
 *
 * `animate = false` - tekst od razu w całości (historia rozmowy). Po dojściu do końca hook nie
 * pracuje (brak pętli rAF).
 */
export function useSmoothText(text: string, animate: boolean): string {
  const [shown, setShown] = useState(() => (animate ? 0 : text.length));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (!animate) {
      setShown(text.length);
      return;
    }
    // Tekst się skrócił (np. nowa wiadomość w tym samym miejscu) - zaczynamy od nowa.
    if (shownRef.current > text.length) setShown(0);
    if (shownRef.current >= text.length) return;

    let frame = 0;
    const tick = () => {
      const backlog = text.length - shownRef.current;
      if (backlog <= 0) return;
      const step = Math.min(40, Math.max(2, Math.ceil(backlog / 60)));
      const next = Math.min(text.length, shownRef.current + step);
      shownRef.current = next;
      setShown(next);
      if (next < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, animate]);

  return animate ? text.slice(0, shown) : text;
}
