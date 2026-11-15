// Linki do systemu w odpowiedzi PoliAI: link otwierający zdanie dostaje odstęp tylko z prawej.

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Właściwość hast (w React: `node.properties`) ustawiana na linkach otwierających zdanie. */
export const SENTENCE_START_PROP = 'dataSentenceStart';

function markSentenceStarts(node: HastNode): void {
  if (!node.children) return;
  node.children.forEach((child, i) => {
    if (child.type === 'element' && child.tagName === 'a') {
      // Element przed linkiem (np. pogrubienie) = środek zdania; znak \u0000 blokuje dopasowanie.
      const prevText = node
        .children!.slice(0, i)
        .map((n) => (n.type === 'text' ? (n.value ?? '') : '\u0000'))
        .join('')
        .trimEnd();
      if (prevText === '' || /[.!?:;]$/.test(prevText)) {
        child.properties = { ...child.properties, [SENTENCE_START_PROP]: 'true' };
      }
    }
    markSentenceStarts(child);
  });
}

/**
 * Wtyczka rehype: oznacza linki otwierające zdanie (pierwsze w akapicie/punkcie albo po . ! ? : ;).
 * Musi działać przed `rehypeFadeWords`, który dzieli tekst na spany.
 */
export function rehypeMarkSentenceStart() {
  return (tree: HastNode) => markSentenceStarts(tree);
}
