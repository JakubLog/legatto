// Płynne pojawianie się strumieniowanego tekstu: każde słowo to osobny <span> z animacją fade-in
// przy montowaniu (klasa w src/index.css). Przy kolejnych fragmentach React zachowuje istniejące
// spany (te same pozycje), więc animują się tylko nowo dopisane słowa.

export const FADE_CLASS = 'poliai-fade';

/** Słowa i białe znaki naprzemiennie (białe znaki jako osobne elementy). */
export function splitWords(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

export function isWhitespace(part: string): boolean {
  return /^\s+$/.test(part);
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function wrapWords(value: string): HastNode[] {
  return splitWords(value).map((part) =>
    isWhitespace(part)
      ? { type: 'text', value: part }
      : { type: 'element', tagName: 'span', properties: { className: [FADE_CLASS] }, children: [{ type: 'text', value: part }] },
  );
}

function transform(node: HastNode): void {
  if (!node.children || node.tagName === 'code' || node.tagName === 'pre') return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value) return wrapWords(child.value);
    transform(child);
    return [child];
  });
}

/** Wtyczka rehype dla react-markdown: owija słowa (poza kodem) w spany z fade-in. */
export function rehypeFadeWords() {
  return (tree: HastNode) => transform(tree);
}
