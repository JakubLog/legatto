// Dopasowanie wgranych plików podpisu do dokumentów (plan 2.2):
// 1) nazwa `DP-000123_v1_...`, 2) dla PDF prefiks SHA-256 równy oryginałowi (PAdES dopisuje przyrostowo),
// 3) ręczny wybór. Kontrole treści w przeglądarce ostrzegają; blokują tylko to, czego serwer nie przyjmie
// albo co na pewno jest błędem (zły typ, przekroczony limit, nieaktualna wersja, brak dokumentu).

import {
  DETACHED_SIGNATURE_MAX_BYTES,
  SIGNING_FILE_MAX_BYTES,
  currentFiles,
  fileExtension,
  formatFileSize,
  isSignatureExtension,
  sha256Hex,
  type SigningDocument,
} from '@/lib/signing';

export type SignedKind = 'podpisany' | 'podpis_zewnetrzny';
export type MatchSource = 'nazwa' | 'tresc' | 'reczny';

export const MATCH_SOURCE_LABELS: Record<MatchSource, string> = {
  nazwa: 'po nazwie',
  tresc: 'po treści',
  reczny: 'ręcznie',
};

const NAME_RE = /^(DP-\d{6})_v(\d{1,3})_/i;

export interface SignedInput {
  /** Stały klucz wiersza podglądu. */
  key: string;
  name: string;
  blob: Blob;
}

export interface MatchRow {
  key: string;
  name: string;
  blob: Blob;
  ext: string;
  size: number;
  sha256: string;
  /** Kod i wersja odczytane z nazwy pliku (null bez dopasowania wzorca). */
  nameCode: string | null;
  nameVersion: number | null;
  documentId: string | null;
  source: MatchSource | null;
  kind: SignedKind;
  /** Rodzaj podpisu da się zmienić (XML/XAdES/.sig - otaczający albo zewnętrzny). */
  kindSwitchable: boolean;
  /** Zawartość zgodna z rozszerzeniem (%PDF-, PK, <, DER 0x30). */
  contentTypeOk: boolean;
  /** Wykryty podpis w treści; null = nie da się sprawdzić w przeglądarce. */
  hasSignature: boolean | null;
  /** PDF: początek pliku identyczny z bieżącym oryginałem; null = nie dotyczy. */
  contentMatchesOriginal: boolean | null;
  skip: boolean;
}

export interface RowCheck {
  level: 'ok' | 'warn' | 'error';
  text: string;
}

const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function startsWithBytes(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((b, i) => bytes[offset + i] === b);
}

/** Pierwszy znak nie-biały (po BOM UTF-8) - dla XML oczekujemy '<'. */
function firstSignificantByte(bytes: Uint8Array): number | undefined {
  let i = startsWithBytes(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1;
  return bytes[i];
}

function looksLikeXml(bytes: Uint8Array): boolean {
  return firstSignificantByte(bytes) === 0x3c;
}

function contentTypeMatches(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case 'pdf':
      return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'asice':
    case 'asics':
      return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case 'xml':
    case 'xades':
      return looksLikeXml(bytes);
    case 'p7s':
    case 'p7m':
      return bytes[0] === 0x30;
    case 'sig':
      // .sig bywa CMS (DER) albo XAdES (XML), zależnie od programu podpisującego.
      return bytes[0] === 0x30 || looksLikeXml(bytes);
    default:
      return false;
  }
}

interface XmlSignatureInfo {
  hasSignature: boolean;
  detached: boolean;
}

/**
 * XML: podpis = element Signature z przestrzeni xmldsig. Zewnętrzny, gdy któraś Reference wskazuje
 * plik poza dokumentem (URI niepuste i nie '#...'); otaczający/otoczony - wszystkie URI lokalne.
 */
function inspectXmlSignature(text: string): XmlSignatureInfo {
  const hasSignature = text.includes(XMLDSIG_NS) && /<([\w.-]+:)?Signature[\s>]/.test(text);
  if (!hasSignature) return { hasSignature, detached: false };
  const uris = [...text.matchAll(/<(?:[\w.-]+:)?Reference\b[^>]*?\bURI\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]);
  return { hasSignature, detached: uris.some((uri) => uri !== '' && !uri.startsWith('#')) };
}

function pdfHasSignature(text: string): boolean {
  return text.includes('/ByteRange') && /\/Type\s*\/Sig\b/.test(text);
}

/** Czy początek `blob` (długość oryginału) ma ten sam SHA-256 co oryginał. */
export async function prefixMatchesOriginal(blob: Blob, original: { size_bytes: number; sha256: string }): Promise<boolean> {
  if (original.size_bytes > blob.size) return false;
  return (await sha256Hex(blob.slice(0, original.size_bytes))) === original.sha256;
}

/**
 * Analiza jednego pliku: typ, podpis, dopasowanie po nazwie i (dla PDF) po treści.
 * `candidates` = dokumenty, którym można wgrać podpis, z bieżącymi plikami.
 * `preferredDocumentId` - dokument wybrany z góry (dialog otwarty ze szczegółów dokumentu).
 */
export async function analyzeSignedFile(
  input: SignedInput,
  candidates: SigningDocument[],
  preferredDocumentId?: string | null,
): Promise<MatchRow> {
  const ext = fileExtension(input.name);
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const nameMatch = NAME_RE.exec(input.name);
  const nameCode = nameMatch ? nameMatch[1].toUpperCase() : null;
  const nameVersion = nameMatch ? Number(nameMatch[2]) : null;

  const row: MatchRow = {
    key: input.key,
    name: input.name,
    blob: input.blob,
    ext,
    size: input.blob.size,
    sha256,
    nameCode,
    nameVersion,
    documentId: null,
    source: null,
    kind: 'podpisany',
    kindSwitchable: false,
    contentTypeOk: isSignatureExtension(ext) && contentTypeMatches(ext, bytes),
    hasSignature: null,
    contentMatchesOriginal: null,
    skip: !isSignatureExtension(ext),
  };
  if (!isSignatureExtension(ext)) return row;

  // Rodzaj i obecność podpisu.
  if (ext === 'pdf') {
    row.hasSignature = pdfHasSignature(latin1(bytes));
  } else if (ext === 'xml' || ext === 'xades' || (ext === 'sig' && looksLikeXml(bytes))) {
    const info = inspectXmlSignature(new TextDecoder('utf-8').decode(bytes));
    row.hasSignature = info.hasSignature;
    row.kind = info.detached ? 'podpis_zewnetrzny' : 'podpisany';
    row.kindSwitchable = true;
  } else if (ext === 'sig' || ext === 'p7s') {
    row.kind = 'podpis_zewnetrzny';
    row.kindSwitchable = ext === 'sig';
  } else if (ext === 'asice' || ext === 'asics') {
    row.hasSignature = latin1(bytes).includes('META-INF/signature');
  }

  // 1) Nazwa pliku.
  const byCode = nameCode ? candidates.find((d) => d.code.toUpperCase() === nameCode) : undefined;
  if (byCode) {
    row.documentId = byCode.id;
    row.source = 'nazwa';
  } else if (!nameCode && preferredDocumentId && candidates.some((d) => d.id === preferredDocumentId)) {
    row.documentId = preferredDocumentId;
    row.source = 'reczny';
  }

  if (ext === 'pdf') {
    if (row.documentId) {
      const { original } = currentFiles(candidates.find((d) => d.id === row.documentId)!);
      if (original?.mime_type === 'application/pdf') row.contentMatchesOriginal = await prefixMatchesOriginal(input.blob, original);
    } else if (!nameCode) {
      // 2) Prefiks SHA-256: każdą długość oryginału liczymy raz.
      const waiting = candidates.filter((d) => d.requires_signature && (d.status === 'do_podpisu' || d.status === 'pobrany'));
      const hashBySize = new Map<number, string>();
      for (const doc of waiting) {
        const { original } = currentFiles(doc);
        if (!original || original.mime_type !== 'application/pdf' || original.size_bytes > row.size) continue;
        let prefix = hashBySize.get(original.size_bytes);
        if (prefix === undefined) {
          prefix = await sha256Hex(bytes.subarray(0, original.size_bytes));
          hashBySize.set(original.size_bytes, prefix);
        }
        if (prefix === original.sha256) {
          row.documentId = doc.id;
          row.source = 'tresc';
          row.contentMatchesOriginal = true;
          break;
        }
      }
    }
  }
  return row;
}

/** Kontrole wiersza przy bieżącym wyborze dokumentu i rodzaju (liczone na nowo po każdej zmianie). */
export function rowChecks(row: MatchRow, candidates: SigningDocument[], rows: MatchRow[]): RowCheck[] {
  const checks: RowCheck[] = [];
  if (!isSignatureExtension(row.ext)) {
    checks.push({ level: 'error', text: `Niedozwolony typ pliku${row.ext ? ` .${row.ext}` : ''}` });
    return checks;
  }
  if (!row.contentTypeOk) checks.push({ level: 'error', text: `Zawartość nie pasuje do rozszerzenia .${row.ext}` });
  const limit = row.kind === 'podpis_zewnetrzny' ? DETACHED_SIGNATURE_MAX_BYTES : SIGNING_FILE_MAX_BYTES;
  if (row.size > limit) checks.push({ level: 'error', text: `Plik większy niż ${formatFileSize(limit)}` });
  if (row.size === 0) checks.push({ level: 'error', text: 'Plik jest pusty' });

  const doc = row.documentId ? candidates.find((d) => d.id === row.documentId) : undefined;
  if (!doc) {
    checks.push({
      level: 'error',
      text:
        row.nameCode && !row.documentId
          ? `Dokument ${row.nameCode} nie czeka na podpis albo jest poza Twoim zakresem - wybierz dokument ręcznie`
          : 'Wybierz dokument',
    });
  } else {
    if (row.nameVersion !== null && row.nameCode === doc.code.toUpperCase() && row.nameVersion !== doc.current_version) {
      checks.push({
        level: 'error',
        text: `Wersja nieaktualna: plik v${row.nameVersion}, bieżąca v${doc.current_version} - podpisz nową wersję`,
      });
    }
    const duplicate = rows.some((r) => r.key !== row.key && !r.skip && r.documentId === doc.id);
    if (duplicate) checks.push({ level: 'error', text: 'Do tego dokumentu przypisano też inny plik' });
    if (currentFiles(doc).signature) checks.push({ level: 'warn', text: 'Zastąpi istniejący podpis' });
  }

  if (row.hasSignature === true) checks.push({ level: 'ok', text: 'Zawiera podpis' });
  if (row.hasSignature === false) checks.push({ level: 'warn', text: 'Nie znaleziono podpisu w pliku' });
  if (row.contentMatchesOriginal === true) checks.push({ level: 'ok', text: 'Treść zgodna z oryginałem' });
  if (row.contentMatchesOriginal === false) {
    checks.push({ level: 'warn', text: 'Początek pliku różni się od oryginału - sprawdź, czy to właściwy dokument' });
  }
  return checks;
}
