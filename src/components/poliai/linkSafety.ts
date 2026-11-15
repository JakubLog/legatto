// Linki z odpowiedzi modelu prowadzące poza aplikację. Tekst modelu może nieść prompt injection
// (sprawy z formularza publicznego, ICS, OCR załączników), więc model może dopisać
// dane z rozmowy do adresu (query, fragment, treść maila) i ukryć go pod niewinnym tekstem linku.
// Bez potwierdzenia otwieramy tylko własny origin oraz https na domenach administracji
// (gov.pl, w tym sejm.gov.pl) bez query i fragmentu. Każdy inny link pokazuje host obok tekstu,
// a kliknięcie najpierw wyświetla pełny adres do potwierdzenia.

/** Hosty zaufane (z subdomenami): domena gov.pl jest rejestrowana tylko dla administracji. */
const TRUSTED_HOST_SUFFIXES = ['gov.pl'];

export interface ExternalLinkInfo {
  /** Host (http/https) albo adresat (mailto) pokazywany obok tekstu linku; null = bez dopisku. */
  label: string | null;
  /** Kliknięcie najpierw pokazuje pełny adres do potwierdzenia. */
  confirm: boolean;
}

/**
 * Klasyfikacja adresu przepuszczonego przez `safeMarkdownUrl` (http/https/mailto/tel albo ścieżka
 * aplikacji). null = adres nieczytelny - renderujemy sam tekst.
 */
export function classifyExternalLink(href: string, ownOrigin: string): ExternalLinkInfo | null {
  if (/^tel:/i.test(href)) return { label: null, confirm: false };
  if (/^mailto:/i.test(href)) {
    const [recipients, query] = href.slice('mailto:'.length).split('?', 2);
    let label = recipients;
    try {
      label = decodeURIComponent(recipients);
    } catch {
      // niepoprawne kodowanie - pokazujemy surowy adres
    }
    // Parametry (subject, body, cc, bcc) mogą nieść dane z rozmowy albo dodatkowych adresatów.
    return { label: label || null, confirm: query !== undefined };
  }
  let url: URL;
  try {
    url = new URL(href, ownOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin === ownOrigin) return { label: null, confirm: false };
  const plain = url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  const trusted = TRUSTED_HOST_SUFFIXES.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
  // url.host: punycode zamiast znaków Unicode (bez podszywania się homoglifami) + ewentualny port.
  return { label: url.host, confirm: !(url.protocol === 'https:' && trusted && plain) };
}
