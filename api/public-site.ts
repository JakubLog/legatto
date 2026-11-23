import type { VercelRequest, VercelResponse } from '@vercel/node';
import { publicSiteSchema } from '../src/lib/siteSnapshot.js';
import { getServiceClient } from './_lib/supabase.js';
import { errorSummary } from './_lib/log-safe.js';

// Dane strony głównej SPA (tryb Vercel i podgląd w CRM): migawka public.service_site_snapshot()
// czytana kluczem service_role - anon traci get_public_* i SELECT słowników w etapie contract
// (supabase/migrations-contract/revoke_anon_public.sql). Odpowiedź = schemat publicSiteSchema
// (src/lib/siteSnapshot.ts): tylko pola strony głównej, bez wpisów bloga i newsletterów
// (te publikuje wyłącznie strona statyczna). URL-e zdjęć zostają takie jak w bazie.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await getServiceClient().rpc('service_site_snapshot');
    if (error) throw error;
    const parsed = publicSiteSchema.safeParse(data);
    if (!parsed.success) {
      // Tylko ścieżka i kod - komunikat zod cytuje odrzuconą wartość.
      const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`);
      console.error('[public-site] migawka niezgodna ze schematem', issues);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).json({ error: 'Niepoprawne dane strony' });
    }
    // Krótki cache: zmiany z panelu admina widać po minucie, a zalew wejść nie trafia w bazę.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(parsed.data);
  } catch (err) {
    console.error('[public-site]', errorSummary(err));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'Nie udało się wczytać danych strony' });
  }
}
