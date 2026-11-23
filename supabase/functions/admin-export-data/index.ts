// Edge Function: admin-export-data (A13, U4)
// Ręczny eksport danych biura dla posła: archiwum ZIP AES-256 (hasło podaje poseł) z tabelami
// biura (JSON Lines) i plikami z bucketów Storage. Jedynym backupem VPS jest backup Hetzner,
// więc ta funkcja daje posłowi kopię, którą sam przechowuje.
//
// Dostęp (fail-closed):
//   - tylko powierzchnia admin (X-Legatto-Surface: admin; na crm proxy zwraca 404 dla admin-*),
//   - Poseł/Administrator (is_posel) z sesją aal2,
//   - wiersze przez RPC export_office_data / export_office_files wołane TOKENEM UŻYTKOWNIKA
//     z przekazanym nagłówkiem powierzchni - baza sama sprawdza require_admin_surface(), rolę i aal2,
//   - pliki pobiera service_role dopiero po tej autoryzacji (lista ścieżek z RPC),
//   - audyt: data.export_started / data.export_finished / data.export_failed (bez treści).
//
// Body: { password: string (12-128 znaków), include_files?: boolean (domyślnie true) }
// Odpowiedź 200: application/zip (strumień), Content-Disposition: attachment; filename="legatto-eksport-RRRR-MM-DD.zip"

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { isCallerAal2 } from '../_shared/auth.ts';
import { adminSurfaceGuard, SURFACE_HEADER } from '../_shared/surface.ts';
import { errorSummary } from '../_shared/log-safe.ts';
import { AesZipWriter } from './zip-aes.ts';

const PAGE_SIZE = 1000;
const ROWS_PER_PART = 20_000;
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

const README = `Eksport danych biura poselskiego (Legatto)

Zawartość:
  manifest.json            - data eksportu, liczba wierszy w tabelach, lista plików i braków
  tables/<tabela>.jsonl    - wiersze tabel (jeden obiekt JSON w linii); duże tabele w częściach
                             tables/<tabela>/part-NNNN.jsonl
  files/<bucket>/<ścieżka> - pliki (załączniki spraw, dokumenty do podpisu, paragony, zdjęcia)

Archiwum jest zaszyfrowane AES-256 (format WinZip AE-2). Otwierają je m.in. 7-Zip (Windows),
Keka (macOS), WinZip, bsdtar. Wbudowany "Archiwizator" macOS nie obsługuje AES.

Eksport nie zawiera sekretów: hashy tokenów MCP/OAuth, PIN-ów, kluczy API, subskrypcji push,
zaufanych urządzeń ani haseł użytkowników.
`;

interface ExportFile {
  bucket_id: string;
  name: string;
  size: number;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }
  const surfaceDenied = adminSurfaceGuard(req, cors);
  if (surfaceDenied) return surfaceDenied;

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ error: 'Metoda niedozwolona' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Brak autoryzacji' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Brak konfiguracji środowiska' }, 500);

  // Nagłówek powierzchni ustawiony przez proxy przekazujemy do PostgREST: RPC eksportu same
  // sprawdzają require_admin_surface() (obrona w głąb, także gdy ktoś wywoła je bezpośrednio).
  const surface = req.headers.get(SURFACE_HEADER);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader, ...(surface ? { [SURFACE_HEADER]: surface } : {}) } },
    auth: { persistSession: false },
  });

  const { data: callerUser, error: userError } = await callerClient.auth.getUser();
  if (userError || !callerUser?.user) return json({ error: 'Nie udało się zweryfikować sesji' }, 401);

  const { data: isPosel, error: roleError } = await callerClient.rpc('is_posel');
  if (roleError) return json({ error: 'Nie udało się zweryfikować uprawnień' }, 500);
  if (isPosel !== true) return json({ error: 'Brak uprawnień (wymagana rola: Poseł lub Administrator)' }, 403);
  if (!(await isCallerAal2(callerClient))) return json({ error: 'Wymagane uwierzytelnienie dwuskładnikowe (2FA)' }, 403);

  const body = (await req.json().catch(() => null)) as { password?: unknown; include_files?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if ([...password].length < MIN_PASSWORD || [...password].length > MAX_PASSWORD) {
    return json({ error: `Hasło archiwum: od ${MIN_PASSWORD} do ${MAX_PASSWORD} znaków` }, 400);
  }
  const includeFiles = body?.include_files !== false;

  // Pierwsze wywołanie RPC eksportu = autoryzacja w bazie (surface, rola, aal2) + wpis audytu.
  const { error: startError } = await callerClient.rpc('export_log', {
    p_phase: 'started',
    p_metadata: { include_files: includeFiles },
  });
  if (startError) {
    console.error('export_log started error', startError.code);
    return startError.code === '42501'
      ? json({ error: 'Eksport dostępny tylko w panelu administracyjnym (admin.app) dla Posła z 2FA' }, 403)
      : json({ error: 'Nie udało się rozpocząć eksportu' }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const zip = new AesZipWriter(password, async (chunk) => {
    await writer.ready;
    await writer.write(chunk);
  });

  const day = new Date().toISOString().slice(0, 10);
  void (async () => {
    const tables: Record<string, number> = {};
    const missing: string[] = [];
    let fileCount = 0;
    try {
      await zip.addFile('README.txt', new TextEncoder().encode(README));
      const { data: tableNames, error: tablesError } = await callerClient.rpc('export_tables');
      if (tablesError || !Array.isArray(tableNames)) throw new Error('export_tables');
      for (const table of tableNames as string[]) {
        tables[table] = await exportTable(callerClient, zip, table);
      }
      let files: ExportFile[] = [];
      if (includeFiles) {
        const { data, error } = await callerClient.rpc('export_office_files');
        if (error || !Array.isArray(data)) throw new Error('export_office_files');
        files = data as ExportFile[];
        for (const f of files) {
          const { data: blob, error: dlError } = await adminClient.storage.from(f.bucket_id).download(f.name);
          if (dlError || !blob) {
            missing.push(`${f.bucket_id}/${f.name}`);
            continue;
          }
          await zip.addFile(`files/${f.bucket_id}/${f.name}`, new Uint8Array(await blob.arrayBuffer()), { compress: false });
          fileCount += 1;
        }
      }
      const manifest = {
        format: 'legatto-export/1',
        generated_at: new Date().toISOString(),
        tables,
        files: fileCount,
        files_missing: missing,
        include_files: includeFiles,
      };
      await zip.addFile('manifest.json', new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
      await zip.finish();
      await writer.close();
      const { error: logError } = await callerClient.rpc('export_log', {
        p_phase: 'finished',
        p_metadata: { tables, files: fileCount, files_missing: missing.length, bytes: zip.bytesWritten },
      });
      if (logError) console.error('export_log finished error', logError.code);
    } catch (err) {
      console.error('admin-export-data failed', errorSummary(err));
      await writer.abort(err).catch(() => undefined);
      const { error: logError } = await callerClient.rpc('export_log', {
        p_phase: 'failed',
        p_metadata: { tables: Object.keys(tables).length, files: fileCount },
      });
      if (logError) console.error('export_log failed error', logError.code);
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="legatto-eksport-${day}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** Wiersze tabeli stronami po PAGE_SIZE; zapis jako JSON Lines (duże tabele w częściach). */
async function exportTable(client: SupabaseClient, zip: AesZipWriter, table: string): Promise<number> {
  const encoder = new TextEncoder();
  let lines: string[] = [];
  let part = 0;
  let total = 0;
  for (let offset = 0; ; ) {
    const { data, error } = await client.rpc('export_office_data', { p_table: table, p_offset: offset, p_limit: PAGE_SIZE });
    if (error || !Array.isArray(data)) throw new Error(`export_office_data ${table}`);
    for (const row of data) lines.push(`${JSON.stringify(row)}\n`);
    total += data.length;
    offset += data.length;
    if (lines.length >= ROWS_PER_PART) {
      part += 1;
      await zip.addFile(`tables/${table}/part-${String(part).padStart(4, '0')}.jsonl`, encoder.encode(lines.join('')));
      lines = [];
    }
    if (data.length < PAGE_SIZE) break;
  }
  if (part === 0) {
    await zip.addFile(`tables/${table}.jsonl`, encoder.encode(lines.join('')));
  } else if (lines.length > 0) {
    part += 1;
    await zip.addFile(`tables/${table}/part-${String(part).padStart(4, '0')}.jsonl`, encoder.encode(lines.join('')));
  }
  return total;
}
