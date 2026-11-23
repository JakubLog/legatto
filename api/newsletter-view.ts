import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceClient } from './_lib/supabase.js';
import { errorSummary } from './_lib/log-safe.js';

// Wersja online newslettera: /n/<slug> (rewrite w vercel.json) -> gotowy HTML z newsletter_issues.html_web.
// Tabela nie ma dostępu dla anon - odczyt kluczem service_role, wyłącznie po niezgadywalnym slugu
// (16 znaków base64url, 96 bitów). Szablon (template) i metadane nie wychodzą na zewnątrz.
// Publicznie tylko wydania wysłane (status 'sent'); szkic (link z maila testowego) nie jest publiczny.
//
// html_web zapisuje przeglądarka (RLS writer), więc treść jest niezaufana: CSP `sandbox` daje stronie
// unikalny (opaque) origin - bez skryptów, formularzy, dostępu do localStorage/sesji portalu na tej
// samej domenie. Ten sam nagłówek ustawia vercel.json dla /n/(.*) (globalny CSP portalu wyłącza /n/).
//
// Cutover (A8): przy ustawionym app_settings.public_site_url wersje online serwuje statyczna strona
// posła (/n/<slug>, publikowana przed wysyłką - request_newsletter_publication), a linki w nowych
// mailach wskazują tę stronę (newsletterWebUrl). Ten endpoint zostaje dla trybu Vercel i dla linków
// z maili wysłanych przed przejściem instancji na VPS; do usunięcia razem z trybem Vercel.

const SLUG_RE = /^[A-Za-z0-9_-]{16}$/;

// Samohostowana czcionka szablonu (src/lib/newsletter/render.ts, public/fonts/newsletter/) -
// font-src https: data: (nie 'self': sandbox daje stronie nieprzewidywalny origin).
const SANDBOX_CSP =
  "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function messagePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0; padding:48px 16px; background:#DCDDE1; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align:center; color:#333E53;">
<h1 style="font-size:22px;">${title}</h1>
<p style="color:#76829D;">${message}</p>
</body></html>`;
}

const NOT_FOUND = messagePage(
  'Nie znaleziono newslettera',
  'Link jest niepełny, newsletter nie został jeszcze wysłany albo został usunięty.',
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', SANDBOX_CSP);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');

  const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
  if (!SLUG_RE.test(slug)) return res.status(404).send(NOT_FOUND);

  try {
    const { data, error } = await getServiceClient()
      .from('newsletter_issues')
      .select('html_web')
      .eq('slug', slug)
      .eq('status', 'sent')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).send(NOT_FOUND);

    // Wysłane wydanie jest niezmienne (RLS: update tylko szkicu) - cache na CDN.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(data.html_web as string);
  } catch (err) {
    console.error('[newsletter-view]', errorSummary(err));
    return res.status(500).send(messagePage('Chwilowy błąd', 'Nie udało się wczytać newslettera. Spróbuj za chwilę.'));
  }
}
