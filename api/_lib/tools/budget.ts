import { getServiceClient } from '../supabase.js';
import { DbError, errorSummary } from '../log-safe.js';
import { logAudit } from '../audit.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  requireString,
  getLimit,
  POSEL_ONLY,
  ToolValidationError,
} from './types.js';
import { EXPENSE_LABELS, withLabel, withLabels } from './labels.js';

const PAYMENT_METHODS = ['przelew', 'karta', 'gotowka', 'inne'] as const;

// Pliki faktur/paragonow: prywatny bucket 'receipts' (limit 5 MB i typy egzekwuje Storage),
// sciezka <user_id>/<timestamp>-<nazwa> jak przy uploadzie w aplikacji (src/hooks/useReceipts.ts,
// stale w src/lib/expenses.ts). MCP nie przenosi plikow, wiec klient wgrywa plik sam PUT-em na
// signed upload URL (budget_receipt_upload_url), a budget_receipt_attach podpina go do wydatku.
const RECEIPT_BUCKET = 'receipts';
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_MIME_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
type ReceiptMime = keyof typeof RECEIPT_MIME_EXT;
const RECEIPT_MIMES = Object.keys(RECEIPT_MIME_EXT) as ReceiptMime[];
// Waznosc signed upload URL - stala po stronie Supabase Storage.
const RECEIPT_UPLOAD_TTL_SECONDS = 2 * 60 * 60;
const RECEIPT_NAME_RE = /^[A-Za-z0-9.-]+$/;

/** `<timestamp>-<slug>.<ext>`; rozszerzenie zawsze z typu pliku, nie z nazwy. */
function receiptFileName(fileName: string, mime: ReceiptMime): string {
  const dot = fileName.lastIndexOf('.');
  const base =
    (dot > 0 ? fileName.slice(0, dot) : fileName)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80) || 'receipt';
  return `${Date.now()}-${base}.${RECEIPT_MIME_EXT[mime]}`;
}

/**
 * Typ pliku z naglowka - nie ufamy Content-Type podanemu przy uploadzie. `bytes` = poczatek
 * pliku (do 1024 B): specyfikacja PDF dopuszcza naglowek %PDF- w dowolnym miejscu tego zakresu.
 */
function sniffReceiptMime(bytes: Uint8Array): ReceiptMime | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  // Sygnatury obrazow sa na poczatku pliku - sprawdzane przed szukaniem %PDF- w calym zakresie.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 8) === 'PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes('%PDF-')) return 'application/pdf';
  return null;
}

export const budgetTools: ToolDefinition[] = [
  {
    name: 'budget_list',
    title: 'Lista wydatków',
    readOnly: true,
    description:
      'Lista wydatków biura z opcjonalnym filtrem miesiąca (YYYY-MM). Pole missing_invoice_file = true oznacza wydatek bez dodanego pliku faktury/paragonu; filtr missing_invoice_file zawęża listę. Dostępne dla Posła i Pracownika (READ).',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Format YYYY-MM, np. "2026-05". Domyślnie bieżący miesiąc.' },
        category_id: { type: 'integer', description: 'ID kategorii (z expense_categories_list)' },
        missing_invoice_file: {
          type: 'boolean',
          description: 'true = tylko wydatki bez pliku faktury/paragonu, false = tylko z plikiem. Brak = wszystkie.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const supabase = getServiceClient();
      const month = optionalString(args, 'month', 7);
      const categoryId = optionalNumber(args, 'category_id');
      const missingInvoiceFile = optionalBoolean(args, 'missing_invoice_file');
      const limit = getLimit(args, 50, 200);

      let from: string, to: string;
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        from = `${month}-01`;
        const [y, m] = month.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        to = `${month}-${String(lastDay).padStart(2, '0')}`;
      } else {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        from = `${y}-${m}-01`;
        const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
        to = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
      }

      let q = supabase
        .from('office_expenses')
        .select('id, title, amount, category_id, expense_date, vendor, invoice_number, payment_method, notes, missing_invoice_file, created_at')
        .gte('expense_date', from)
        .lte('expense_date', to)
        .order('expense_date', { ascending: false })
        .limit(limit);
      if (categoryId !== null) q = q.eq('category_id', categoryId);
      if (missingInvoiceFile !== null) q = q.eq('missing_invoice_file', missingInvoiceFile);

      const { data, error } = await q;
      if (error) throw new DbError(error);
      const rows = data ?? [];
      const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
      return jsonResult({
        month: `${from.slice(0, 7)}`,
        total_pln: total,
        count: rows.length,
        missing_invoice_file_count: rows.filter((r) => r.missing_invoice_file).length,
        expenses: await withLabels(rows, EXPENSE_LABELS),
      });
    },
  },

  {
    name: 'budget_get',
    title: 'Szczegóły wydatku',
    readOnly: true,
    description:
      'Pełne dane jednego wydatku (missing_invoice_file = brak pliku faktury/paragonu). Dostępne dla Posła i Pracownika (READ).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { data, error } = await supabase.from('office_expenses').select('*').eq('id', id).maybeSingle();
      if (error) throw new DbError(error);
      if (!data) return textResult(`Wydatek o id=${id} nie istnieje.`, true);
      return jsonResult(await withLabel(data, EXPENSE_LABELS));
    },
  },

  {
    name: 'budget_create',
    title: 'Dodanie wydatku',
    description: 'Dodaje nowy wydatek biura. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        amount: { type: 'number', minimum: 0.01, description: 'Kwota w PLN' },
        expense_date: { type: 'string', description: 'YYYY-MM-DD' },
        category_id: { type: 'integer', description: 'ID kategorii (z expense_categories_list)' },
        vendor: { type: 'string', maxLength: 200 },
        invoice_number: { type: 'string', maxLength: 100 },
        payment_method: { type: 'string', enum: PAYMENT_METHODS },
        notes: { type: 'string', maxLength: 2000 },
      },
      required: ['title', 'amount', 'expense_date'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    nonDestructive: true,
    handler: async (args, ctx) => {
      const amount = optionalNumber(args, 'amount');
      if (amount === null || amount <= 0) throw new ToolValidationError('amount musi byc liczba dodatnia.');
      const dateStr = requireString(args, 'expense_date', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new ToolValidationError('expense_date musi byc w formacie YYYY-MM-DD.');
      const supabase = getServiceClient();
      const { data, error } = await supabase.from('office_expenses').insert({
        title: requireString(args, 'title', 200),
        amount,
        expense_date: dateStr,
        category_id: optionalNumber(args, 'category_id'),
        vendor: optionalString(args, 'vendor', 200),
        invoice_number: optionalString(args, 'invoice_number', 100),
        payment_method: optionalEnum(args, 'payment_method', PAYMENT_METHODS),
        notes: optionalString(args, 'notes', 2000),
        created_by: ctx.userId,
      }).select().single();
      if (error) throw new DbError(error);
      await logAudit(ctx, 'mcp.expense_create', { entityType: 'expense', entityId: data.id, metadata: { amount, tool: 'budget_create' } });
      return jsonResult({ created: true, expense: await withLabel(data, EXPENSE_LABELS) });
    },
  },

  {
    name: 'budget_update',
    title: 'Zmiana wydatku',
    description: 'Aktualizuje wydatek. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string', maxLength: 200 },
        amount: { type: 'number', minimum: 0.01 },
        expense_date: { type: 'string' },
        category_id: { type: 'integer', description: 'ID kategorii (z expense_categories_list)' },
        vendor: { type: 'string', maxLength: 200 },
        invoice_number: { type: 'string', maxLength: 100 },
        payment_method: { type: 'string', enum: PAYMENT_METHODS },
        notes: { type: 'string', maxLength: 2000 },
      },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    nonDestructive: true,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const update: Record<string, unknown> = {};
      if (args.title !== undefined) update.title = optionalString(args, 'title', 200);
      if (args.amount !== undefined) update.amount = optionalNumber(args, 'amount');
      if (args.expense_date !== undefined) update.expense_date = optionalString(args, 'expense_date', 10);
      if (args.category_id !== undefined) update.category_id = optionalNumber(args, 'category_id');
      if (args.vendor !== undefined) update.vendor = optionalString(args, 'vendor', 200);
      if (args.invoice_number !== undefined) update.invoice_number = optionalString(args, 'invoice_number', 100);
      if (args.payment_method !== undefined) update.payment_method = optionalEnum(args, 'payment_method', PAYMENT_METHODS);
      if (args.notes !== undefined) update.notes = optionalString(args, 'notes', 2000);
      if (Object.keys(update).length === 0) return textResult('Brak pol do zaktualizowania.', true);
      const supabase = getServiceClient();
      const { data, error } = await supabase.from('office_expenses').update(update).eq('id', id).select().single();
      if (error) throw new DbError(error);
      await logAudit(ctx, 'mcp.expense_update', { entityType: 'expense', entityId: id, metadata: { fields: Object.keys(update), tool: 'budget_update' } });
      return jsonResult({ updated: true, expense: await withLabel(data, EXPENSE_LABELS) });
    },
  },

  {
    name: 'budget_delete',
    title: 'Usunięcie wydatku',
    description: 'Przenosi wydatek (z paragonem) do kosza na 7 dni - przywraca Poseł lub Administrator w portalu (Kosz). Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { error } = await supabase.from('office_expenses').delete().eq('id', id);
      if (error) throw new DbError(error);
      await logAudit(ctx, 'mcp.expense_delete', { entityType: 'expense', entityId: id, metadata: { tool: 'budget_delete' } });
      return jsonResult({ deleted: true, id });
    },
  },

  {
    name: 'budget_receipt_upload_url',
    title: 'Link do wgrania faktury',
    channels: ['mcp'],
    description:
      'Krok 1 z 2 dodania pliku faktury/paragonu do wydatku. Zwraca jednorazowy upload_url (ważny 2 h): wyślij na niego plik żądaniem HTTP PUT z nagłówkiem Content-Type = mime, ' +
      'np. curl -X PUT -H "Content-Type: application/pdf" --data-binary @faktura.pdf "<upload_url>". Potem wywołaj budget_receipt_attach z id wydatku i zwróconym path. ' +
      'Formaty: PDF, JPG, PNG, WEBP, maks. 5 MB. Wymaga wysłania pliku przez HTTP (Claude Code, Claude Desktop z powłoką, sandbox wykonywania kodu claude.ai z dostępem do domeny z upload_url). ' +
      'Gdy się nie da, plik dodaje się w aplikacji (Budżet → edycja wydatku). Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID wydatku' },
        file_name: { type: 'string', minLength: 1, maxLength: 200, description: 'Nazwa pliku, np. faktura-FV-12-2026.pdf' },
        mime: { type: 'string', enum: RECEIPT_MIMES },
      },
      required: ['id', 'file_name', 'mime'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    nonDestructive: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const fileName = requireString(args, 'file_name', 200);
      const mime = optionalEnum(args, 'mime', RECEIPT_MIMES);
      if (mime === null) throw new ToolValidationError(`Pole "mime" jest wymagane (${RECEIPT_MIMES.join(', ')}).`);
      const supabase = getServiceClient();
      const { data: expense, error: expenseError } = await supabase.from('office_expenses').select('id').eq('id', id).maybeSingle();
      if (expenseError) throw new DbError(expenseError);
      if (!expense) return textResult(`Wydatek o id=${id} nie istnieje.`, true);

      const path = `${ctx.userId}/${receiptFileName(fileName, mime)}`;
      const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUploadUrl(path);
      if (error) throw new DbError(error);
      return jsonResult({
        upload_url: data.signedUrl,
        method: 'PUT',
        headers: { 'Content-Type': mime },
        path,
        expires_in_seconds: RECEIPT_UPLOAD_TTL_SECONDS,
        max_bytes: RECEIPT_MAX_BYTES,
        example: `curl -X PUT -H "Content-Type: ${mime}" --data-binary @"<plik>" "<upload_url>"`,
        next_step: `Po wgraniu wywołaj budget_receipt_attach z id="${id}" i path="${path}".`,
        if_blocked: `Odpowiedź 403 host_not_allowed oznacza blokadę sieci sandboxa (claude.ai): administrator dodaje domenę ${new URL(data.signedUrl).host} w Ustawienia → Możliwości → dostęp do sieci (dodatkowe dozwolone domeny). Inaczej plik dodaje się w aplikacji.`,
      });
    },
  },

  {
    name: 'budget_receipt_attach',
    title: 'Podpięcie faktury do wydatku',
    channels: ['mcp'],
    description:
      'Krok 2 z 2: podpina plik wgrany na upload_url z budget_receipt_upload_url jako fakturę/paragon wydatku (missing_invoice_file staje się false). ' +
      'Sprawdza, że plik istnieje, jest PDF/JPG/PNG/WEBP do 5 MB i że jego zawartość zgadza się z mime podanym w kroku 1. ' +
      'Gdy wydatek ma już plik, podmiana wymaga replace: true i bezpowrotnie usuwa poprzedni plik - najpierw zapytaj użytkownika. Tylko Poseł.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID wydatku' },
        path: { type: 'string', maxLength: 200, description: 'path zwrócony przez budget_receipt_upload_url' },
        replace: { type: 'boolean', description: 'true = podmień istniejący plik wydatku (poprzedni zostanie usunięty). Tylko po zgodzie użytkownika.' },
      },
      required: ['id', 'path'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const path = requireString(args, 'path', 200);
      const folder = `${ctx.userId}/`;
      if (!path.startsWith(folder) || !RECEIPT_NAME_RE.test(path.slice(folder.length))) {
        throw new ToolValidationError('Pole "path" musi być ścieżką zwróconą przez budget_receipt_upload_url.');
      }
      const supabase = getServiceClient();
      const { data: expense, error: expenseError } = await supabase
        .from('office_expenses')
        .select('id, receipt_path')
        .eq('id', id)
        .maybeSingle();
      if (expenseError) throw new DbError(expenseError);
      if (!expense) return textResult(`Wydatek o id=${id} nie istnieje.`, true);
      const previous = expense.receipt_path;
      if (previous === path) return textResult('Ten plik jest już podpięty do tego wydatku - nic nie zmieniono.');
      if (previous && optionalBoolean(args, 'replace') !== true) {
        return textResult(
          'Wydatek ma już plik faktury/paragonu. Podmiana bezpowrotnie usunie poprzedni plik - zapytaj użytkownika i wywołaj ponownie z replace: true. Wgrany plik czeka do 7 dni (path bez zmian).',
          true,
        );
      }

      const { count: usedBy, error: usedError } = await supabase
        .from('office_expenses')
        .select('id', { count: 'exact', head: true })
        .eq('receipt_path', path)
        .neq('id', id);
      if (usedError) throw new DbError(usedError);
      if (usedBy) return textResult('Ten plik jest już załącznikiem innego wydatku - wgraj go ponownie przez budget_receipt_upload_url.', true);

      const { data: file, error: downloadError } = await supabase.storage.from(RECEIPT_BUCKET).download(path);
      if (downloadError || !file) {
        return textResult('Nie ma wgranego pliku pod tą ścieżką. Wyślij plik PUT-em na upload_url (ważny 2 h) i spróbuj ponownie.', true);
      }
      const mime = sniffReceiptMime(new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
      if (mime === null || file.size > RECEIPT_MAX_BYTES) {
        await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
        return textResult('Plik odrzucony: dozwolone są tylko PDF, JPG, PNG i WEBP do 5 MB. Wgraj poprawny plik przez nowy upload_url.', true);
      }
      // Storage serwuje plik z Content-Type z PUT, a podglad w aplikacji wybiera po receipt_mime -
      // oba (i rozszerzenie w sciezce z kroku 1) musza sie zgadzac z zawartoscia.
      if (file.type.split(';')[0].trim() !== mime || !path.endsWith(`.${RECEIPT_MIME_EXT[mime]}`)) {
        await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
        return textResult(
          `Plik odrzucony: zawartość to ${mime}, a typ podany przy wgraniu był inny. Pobierz nowy upload_url z mime="${mime}" i wyślij plik z nagłówkiem Content-Type: ${mime}.`,
          true,
        );
      }

      // Zapis tylko, gdy receipt_path nadal jest taki jak przy sprawdzeniu replace (wyscig z
      // aplikacja albo drugim wywolaniem). Indeks unikalny receipt_path: 23505 = plik podpiety
      // w miedzyczasie do innego wydatku.
      const update = supabase.from('office_expenses').update({ receipt_path: path, receipt_mime: mime }).eq('id', id);
      const { data, error } = await (previous ? update.eq('receipt_path', previous) : update.is('receipt_path', null))
        .select()
        .maybeSingle();
      if (error?.code === '23505') {
        return textResult('Ten plik został w międzyczasie podpięty do innego wydatku - wgraj go ponownie przez budget_receipt_upload_url.', true);
      }
      if (error) throw new DbError(error);
      if (!data) {
        return textResult('Plik wydatku zmienił się w międzyczasie - nic nie zapisano. Sprawdź budget_get i spróbuj ponownie (wgrany plik czeka do 7 dni pod tym samym path).', true);
      }
      // Jak w formularzu aplikacji: stary plik sprzatamy best-effort, rekord jest juz zapisany.
      // Indeks unikalny gwarantuje, ze zaden inny wydatek na niego nie wskazuje.
      if (previous) {
        const { error: removeError } = await supabase.storage.from(RECEIPT_BUCKET).remove([previous]);
        if (removeError) console.error('[mcp] receipt remove error', errorSummary(removeError));
      }
      await logAudit(ctx, 'mcp.expense_receipt_attach', {
        entityType: 'expense',
        entityId: id,
        metadata: { path, previous, mime, size: file.size, replaced: Boolean(previous), tool: 'budget_receipt_attach' },
      });
      return jsonResult({ attached: true, expense: await withLabel(data, EXPENSE_LABELS) });
    },
  },
];
