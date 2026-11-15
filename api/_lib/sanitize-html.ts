// Sanityzacja HTML interpelacji po stronie serwera (C3-01): podgląd (iframe z content_html) i tekst
// kopiowany do Sejmu (content_text liczony z wyniku) muszą pokazywać to samo. Allow-lista znaczników
// strukturalnych bez atrybutów wyglądu: znikają style/class/id/hidden, <style>, <script>, <template>,
// <noscript>, <svg>, komentarze, obsługa zdarzeń (on*) i adresy inne niż http(s)/mailto. Bez CSS nie da
// się ukryć tekstu (display:none, font-size:0, kolor tła), więc to, co zostaje, jest widoczne w podglądzie.
// Nieznane znaczniki są rozpakowywane (treść zostaje i jest widoczna), np. <font color>, <details>, <del>.
// Bez nowych zależności: prosty tokenizer HTML; wynik zawsze jest zbalansowany i w pełni escapowany.

/** Dozwolone znaczniki i ich atrybuty (wartości sprawdza ATTRIBUTE_CHECKS). */
const ALLOWED_TAGS: Record<string, readonly string[]> = {
  p: [], br: [], hr: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
  strong: [], b: [], em: [], i: [], u: [], sub: [], sup: [], small: [],
  span: [], div: [], blockquote: [], pre: [], code: [], center: [],
  ul: [], ol: ['start'], li: [], dl: [], dt: [], dd: [],
  table: ['border'], thead: [], tbody: [], tfoot: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  caption: [], colgroup: ['span'], col: ['span'],
  a: ['href'], img: ['src', 'alt'],
  figure: [], figcaption: [], section: [], article: [], header: [], footer: [], main: [], address: [],
};

const VOID_TAGS: Record<string, true> = {
  br: true, hr: true, img: true, col: true, area: true, base: true, embed: true, input: true,
  link: true, meta: true, param: true, source: true, track: true, wbr: true, keygen: true,
};

// Treść surowa do pierwszego </nazwa> - usuwana w całości.
const RAW_TEXT_DROP: Record<string, true> = {
  script: true, style: true, textarea: true, title: true, xmp: true, iframe: true, noembed: true, noframes: true, noscript: true,
};
// Elementy usuwane razem z zawartością (treść zastępcza albo niewidoczna / pozycjonowana poza tekstem).
const DROP_WITH_CONTENT: Record<string, true> = {
  template: true, svg: true, math: true, object: true, applet: true, select: true, datalist: true,
  canvas: true, audio: true, video: true, picture: true, map: true,
};
// Zagnieżdżanie zmniejsza czcionkę (small w small...) - tylko jeden poziom, głębsze są rozpakowywane.
const SHRINKING: Record<string, true> = { small: true, sub: true, sup: true };

const TAG_NAME_RE = /[a-z][^\s/>]*/iy;
const ATTR_NAME_RE = /[^\s/>=]+/y;
const UNQUOTED_VALUE_RE = /[^\s>]*/y;
const COMMENT_END_RE = /--!?>/g;

const DIGITS = /^\d{1,3}$/;
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

const ATTRIBUTE_CHECKS: Record<string, (value: string) => boolean> = {
  start: (v) => DIGITS.test(v),
  border: (v) => DIGITS.test(v),
  colspan: (v) => DIGITS.test(v),
  rowspan: (v) => DIGITS.test(v),
  span: (v) => DIGITS.test(v),
  href: (v) => SAFE_URL.test(v),
  src: (v) => DATA_IMAGE.test(v),
  alt: () => true,
};

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', tab: '\t', newline: '\n', colon: ':' };

/** Dekodowanie encji w wartości atrybutu (sprawdzamy i zapisujemy wartość po dekodowaniu). */
function decodeAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tekst: encje zostają (dekoduje przeglądarka i html-to-text), pojedyncze & < > są escapowane. */
function escapeText(text: string): string {
  return text
    .replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{0,31});)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface Tag {
  name: string;
  end: boolean;
  attributes: [string, string][];
  selfClosing: boolean;
  /** Indeks pierwszego znaku po tagu; -1 = tag niedomknięty do końca dokumentu. */
  next: number;
}

/** Parsuje tag od `<` na pozycji `start` (za `<` litera albo `/litera`). */
function readTag(html: string, start: number): Tag {
  let i = start + 1;
  const end = html[i] === '/';
  if (end) i++;
  TAG_NAME_RE.lastIndex = i;
  const name = (TAG_NAME_RE.exec(html)?.[0] ?? '').toLowerCase();
  i += name.length;
  const attributes: [string, string][] = [];
  while (i < html.length) {
    while (i < html.length && /[\s/]/.test(html[i])) i++;
    if (i >= html.length) break;
    if (html[i] === '>') return { name, end, attributes, selfClosing: html[i - 1] === '/', next: i + 1 };
    ATTR_NAME_RE.lastIndex = i;
    const attrName = ATTR_NAME_RE.exec(html)?.[0] ?? html[i];
    i += attrName.length;
    while (i < html.length && /\s/.test(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close === -1) return { name, end, attributes, selfClosing: false, next: -1 };
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        UNQUOTED_VALUE_RE.lastIndex = i;
        value = UNQUOTED_VALUE_RE.exec(html)?.[0] ?? '';
        i += value.length;
      }
    }
    attributes.push([attrName.toLowerCase(), value]);
  }
  return { name, end, attributes, selfClosing: false, next: -1 };
}

/** Koniec elementu z treścią surową (`</nazwa` + spacja, `/` albo `>`); -1 = brak. */
function rawTextEnd(html: string, from: number, name: string): number {
  const re = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
  re.lastIndex = from;
  const match = re.exec(html);
  if (!match) return -1;
  const close = html.indexOf('>', match.index);
  return close === -1 ? -1 : close + 1;
}

function renderStartTag(name: string, attributes: [string, string][]): string {
  const allowed = ALLOWED_TAGS[name];
  const seen = new Set<string>();
  let out = `<${name}`;
  for (const [attr, rawValue] of attributes) {
    if (seen.has(attr)) continue; // jak przeglądarka: liczy się pierwsze wystąpienie
    seen.add(attr);
    if (!allowed.includes(attr)) continue;
    // Znaki kontrolne usuwamy przed testem schematu (java\tscript: → javascript:, odrzucone).
    // eslint-disable-next-line no-control-regex -- celowo usuwamy znaki kontrolne
    const value = decodeAttribute(rawValue).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!ATTRIBUTE_CHECKS[attr](value)) continue;
    out += ` ${attr}="${escapeAttribute(value)}"`;
  }
  return `${out}>`;
}

/** Zwraca bezpieczny, zbalansowany HTML z allow-listy (puste wejście → pusty wynik). */
export function sanitizeHtml(input: string): string {
  // eslint-disable-next-line no-control-regex -- celowo usuwamy NUL
  const html = input.replace(/\u0000/g, '');
  const out: string[] = [];
  const stack: string[] = [];
  // Pominięcie elementu z zawartością: nazwa i głębokość zagnieżdżenia tej samej nazwy.
  let skip: { name: string; depth: number } | null = null;
  let text = '';
  const flushText = () => {
    if (text && !skip) out.push(escapeText(text));
    text = '';
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    const after = html[lt + 1] ?? '';

    // Komentarze, <!DOCTYPE>, <![CDATA[...]]>, <?...?> i </ bez nazwy: pomijane.
    if (after === '!' || after === '?' || (after === '/' && !/[a-z]/i.test(html[lt + 2] ?? ''))) {
      flushText();
      if (html.startsWith('<!--', lt)) {
        COMMENT_END_RE.lastIndex = lt + 4;
        const close = COMMENT_END_RE.exec(html);
        if (!close) break;
        i = close.index + close[0].length;
      } else {
        const close = html.indexOf('>', lt);
        if (close === -1) break;
        i = close + 1;
      }
      continue;
    }
    // Samotne `<` (np. "a < b") to tekst.
    if (!/[a-z]/i.test(after) && after !== '/') {
      text += '<';
      i = lt + 1;
      continue;
    }

    flushText();
    const tag = readTag(html, lt);
    if (tag.next === -1) break; // tag niedomknięty do końca dokumentu - przeglądarka też go odrzuca
    i = tag.next;
    const { name } = tag;

    if (skip) {
      if (name === skip.name) {
        skip.depth += tag.end ? -1 : 1;
        if (skip.depth === 0) skip = null;
      }
      continue;
    }
    if (!tag.end && Object.hasOwn(RAW_TEXT_DROP, name)) {
      const close = rawTextEnd(html, i, name);
      if (close === -1) break;
      i = close;
      continue;
    }
    if (!tag.end && name === 'plaintext') break;
    if (!tag.end && Object.hasOwn(DROP_WITH_CONTENT, name)) {
      // <svg/> i <math/> są w HTML domknięte od razu (elementy obce).
      if (!tag.selfClosing) skip = { name, depth: 1 };
      continue;
    }
    if (!Object.hasOwn(ALLOWED_TAGS, name)) continue; // rozpakowanie: treść zostaje, znacznik znika

    if (tag.end) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (Object.hasOwn(SHRINKING, name) && stack.some((open) => Object.hasOwn(SHRINKING, open))) continue;
    out.push(renderStartTag(name, tag.attributes));
    if (!Object.hasOwn(VOID_TAGS, name)) stack.push(name);
  }
  flushText();
  while (stack.length > 0) out.push(`</${stack.pop()}>`);
  return out.join('');
}
