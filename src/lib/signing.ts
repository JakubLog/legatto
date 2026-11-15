// Moduł "Dokumenty do podpisu": typy, statusy, widoki, limity i reguły uprawnień po stronie UI.
// Źródło prawdy to RPC `signing_*` i polityki RLS (migracja 20261111100000_signing_documents.sql);
// te helpery tylko ukrywają akcje, których serwer i tak by nie przyjął.

import type { AppRole } from '@/integrations/supabase/types';
import { isAdmin } from '@/lib/permissions';

export type SigningStatus = 'do_podpisu' | 'pobrany' | 'do_poprawy' | 'podpisany' | 'wyslany' | 'anulowany';
export type SigningFileKind = 'oryginal' | 'podpisany' | 'podpis_zewnetrzny';

export interface SigningFile {
  id: string;
  document_id: string;
  kind: SigningFileKind;
  version: number;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  is_current: boolean;
  created_by: string | null;
  created_at: string;
}

export interface SigningDocument {
  id: string;
  code: string;
  title: string;
  description: string | null;
  recipient_name: string | null;
  send_subject: string | null;
  send_text: string | null;
  case_id: string | null;
  requires_signature: boolean;
  status: SigningStatus;
  current_version: number;
  return_notes: string | null;
  due_date: string | null;
  last_batch_id: string | null;
  sent_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  signed_at: string | null;
  signed_by: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  files?: SigningFile[];
}

export const SIGNING_BUCKET = 'signing-documents';

export const SIGNING_STATUSES: SigningStatus[] = [
  'do_podpisu',
  'pobrany',
  'do_poprawy',
  'podpisany',
  'wyslany',
  'anulowany',
];

export const SIGNING_STATUS_LABELS: Record<SigningStatus, string> = {
  do_podpisu: 'Do podpisu',
  pobrany: 'Pobrany w paczce',
  do_poprawy: 'Do poprawy',
  podpisany: 'Podpisany',
  wyslany: 'Wysłany',
  anulowany: 'Anulowany',
};

/** Etykieta statusu dokumentu: bez wymogu podpisu `podpisany` znaczy "Gotowy do wysyłki". */
export function signingStatusLabel(doc: Pick<SigningDocument, 'status' | 'requires_signature'>): string {
  if (doc.status === 'podpisany' && !doc.requires_signature) return 'Gotowy do wysyłki';
  return SIGNING_STATUS_LABELS[doc.status];
}

// ---------------------------------------------------------------------------
// Widoki listy (?widok=)

export type SigningView = 'do-podpisu' | 'podpisane' | 'wyslane' | 'wszystkie';

export interface SigningViewInfo {
  value: SigningView;
  label: string;
  /** `null` = wszystkie statusy (bez anulowanych w liczniku domyślnym - patrz `SIGNING_VIEW_STATUSES`). */
  statuses: SigningStatus[] | null;
}

export const SIGNING_VIEWS: SigningViewInfo[] = [
  { value: 'do-podpisu', label: 'Do podpisu', statuses: ['do_podpisu', 'pobrany', 'do_poprawy'] },
  { value: 'podpisane', label: 'Podpisane', statuses: ['podpisany'] },
  { value: 'wyslane', label: 'Wysłane', statuses: ['wyslany'] },
  { value: 'wszystkie', label: 'Wszystkie', statuses: null },
];

export const DEFAULT_SIGNING_VIEW: SigningView = 'do-podpisu';

export function parseSigningView(value: string | null | undefined): SigningView {
  return SIGNING_VIEWS.some((v) => v.value === value) ? (value as SigningView) : DEFAULT_SIGNING_VIEW;
}

export function signingViewStatuses(view: SigningView): SigningStatus[] | null {
  return SIGNING_VIEWS.find((v) => v.value === view)?.statuses ?? null;
}

// ---------------------------------------------------------------------------
// Pliki: rozszerzenia, MIME, limity

export const ORIGINAL_EXTENSIONS = ['pdf', 'docx'] as const;
export const SIGNATURE_EXTENSIONS = ['pdf', 'xml', 'xades', 'p7s', 'sig', 'p7m', 'asice', 'asics'] as const;
export type OriginalExtension = (typeof ORIGINAL_EXTENSIONS)[number];
export type SignatureExtension = (typeof SIGNATURE_EXTENSIONS)[number];

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Mapa rozszerzenie → MIME (ta sama allow-lista co bucket; bez application/octet-stream). */
export const SIGNING_MIME_BY_EXT: Record<OriginalExtension | SignatureExtension, string> = {
  pdf: 'application/pdf',
  docx: DOCX_MIME,
  xml: 'application/xml',
  xades: 'application/xml',
  p7s: 'application/pkcs7-signature',
  sig: 'application/pkcs7-signature',
  p7m: 'application/pkcs7-mime',
  asice: 'application/vnd.etsi.asic-e+zip',
  asics: 'application/vnd.etsi.asic-s+zip',
};

export const SIGNING_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const DETACHED_SIGNATURE_MAX_BYTES = 1024 * 1024;

export const SIGNING_TITLE_MIN = 3;
export const SIGNING_TITLE_MAX = 200;
export const SIGNING_DESCRIPTION_MAX = 2000;
export const SIGNING_RECIPIENT_NAME_MAX = 300;
export const SIGNING_SEND_SUBJECT_MAX = 255;
export const SIGNING_SEND_TEXT_MAX = 5000;
export const SIGNING_RETURN_NOTES_MAX = 2000;
export const SIGNING_SENT_NOTE_MAX = 1000;
export const SIGNING_CANCEL_REASON_MAX = 2000;

/** Pozycji w jednym `signing_create_documents`. */
export const SIGNING_CREATE_MAX = 50;
/** Dokumentów w jednej paczce ZIP (`signing_create_batch`). */
export const SIGNING_BATCH_MAX = 20;
/** Pozycji w jednym `signing_attach_signed`. */
export const SIGNING_ATTACH_MAX = 40;
/** Wgrany .zip z podpisanymi plikami: maks. pozycji i łączny rozmiar po rozpakowaniu. */
export const SIGNED_ZIP_MAX_ENTRIES = 40;
export const SIGNED_ZIP_MAX_BYTES = 300 * 1024 * 1024;

/** Rozszerzenie pliku (małe litery, bez kropki); '' gdy brak. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isOriginalExtension(ext: string): ext is OriginalExtension {
  return (ORIGINAL_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSignatureExtension(ext: string): ext is SignatureExtension {
  return (SIGNATURE_EXTENSIONS as readonly string[]).includes(ext);
}

export function mimeForExtension(ext: string): string | null {
  return isOriginalExtension(ext) || isSignatureExtension(ext) ? SIGNING_MIME_BY_EXT[ext] : null;
}

/** Ścieżka oryginału w buckecie: `{document_id}/oryginal/v{n}-{file_id}.{ext}`. */
export function originalStoragePath(documentId: string, version: number, fileId: string, ext: OriginalExtension): string {
  return `${documentId}/oryginal/v${version}-${fileId}.${ext}`;
}

/** Ścieżka pliku podpisu: `{document_id}/podpisane/v{n}-{file_id}.{ext}`. */
export function signedStoragePath(documentId: string, version: number, fileId: string, ext: SignatureExtension): string {
  return `${documentId}/podpisane/v${version}-${fileId}.${ext}`;
}

export const SIGNING_FILE_KIND_LABELS: Record<SigningFileKind, string> = {
  oryginal: 'Oryginał',
  podpisany: 'Podpisany',
  podpis_zewnetrzny: 'Podpis zewnętrzny',
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
}

// ---------------------------------------------------------------------------
// Nazwy

const PL_FROM = 'ąćęłńóśźż';
const PL_TO = 'acelnoszz';

/**
 * Slug jak SQL `public.signing_slug`: translate(lower(t), 'ąćęłńóśźż', 'acelnoszz'),
 * ciągi spoza [a-z0-9] → '-', obcięcie '-' z brzegów, left(60), obcięcie '-' z końca, pusty → 'dokument'.
 */
export function signingSlug(title: string, max = 60): string {
  let v = '';
  for (const ch of title.toLowerCase()) {
    const i = PL_FROM.indexOf(ch);
    v += i >= 0 ? PL_TO[i] : ch;
  }
  v = v.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  v = v.slice(0, max).replace(/-+$/, '');
  return v || 'dokument';
}

/** Tytuł dokumentu z nazwy pliku: bez rozszerzenia, '_' jako spacje, przycięty do limitu. */
export function titleFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SIGNING_TITLE_MAX);
}

/** Nazwa pliku do zapisu na dysku dla pliku dokumentu (kod, wersja, slug, rozszerzenie ścieżki). */
export function downloadFilename(doc: Pick<SigningDocument, 'code' | 'title'>, file: Pick<SigningFile, 'version' | 'kind' | 'storage_path'>): string {
  const ext = fileExtension(file.storage_path);
  const suffix = file.kind === 'oryginal' ? '' : file.kind === 'podpisany' ? '_podpisany' : '_podpis';
  return `${doc.code}_v${file.version}_${signingSlug(doc.title)}${suffix}${ext ? `.${ext}` : ''}`;
}

// ---------------------------------------------------------------------------
// Hash

export async function sha256Hex(data: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  const buffer =
    data instanceof Blob ? await data.arrayBuffer() : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', buffer as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Uprawnienia (lustro warunków RPC)

const EDITABLE: SigningStatus[] = ['do_podpisu', 'pobrany', 'do_poprawy', 'podpisany'];
// Autor (nie Poseł/administrator) zmienia dane tylko przed pobraniem do podpisu i po zwrocie do
// poprawy: później adresat/temat/treść są zamrożone (DOC-01, signing_update_document → 42501).
const AUTHOR_EDITABLE: SigningStatus[] = ['do_podpisu', 'do_poprawy'];
const REPLACEABLE: SigningStatus[] = ['do_podpisu', 'pobrany', 'do_poprawy'];
const RETURNABLE: SigningStatus[] = ['do_podpisu', 'pobrany', 'podpisany'];
const BATCHABLE: SigningStatus[] = ['do_podpisu', 'pobrany'];
const SIGNABLE: SigningStatus[] = ['do_podpisu', 'pobrany', 'podpisany'];

export interface SigningActor {
  userId: string | null | undefined;
  role: AppRole | null | undefined;
}

type DocLike = Pick<SigningDocument, 'status' | 'created_by' | 'requires_signature'>;

function isAuthor(doc: DocLike, actor: SigningActor): boolean {
  return Boolean(actor.userId) && doc.created_by === actor.userId;
}

export function canUpdateDocument(doc: DocLike, actor: SigningActor): boolean {
  if (isAdmin(actor.role)) return EDITABLE.includes(doc.status);
  return isAuthor(doc, actor) && AUTHOR_EDITABLE.includes(doc.status);
}

export function canReplaceOriginal(doc: DocLike, actor: SigningActor): boolean {
  return (isAuthor(doc, actor) || isAdmin(actor.role)) && REPLACEABLE.includes(doc.status);
}

export function canReturnDocument(doc: DocLike, actor: SigningActor): boolean {
  return isAdmin(actor.role) && RETURNABLE.includes(doc.status);
}

export function canCancelDocument(doc: DocLike, actor: SigningActor): boolean {
  if (isAdmin(actor.role)) return [...REPLACEABLE, 'podpisany'].includes(doc.status);
  return isAuthor(doc, actor) && REPLACEABLE.includes(doc.status);
}

export function canBatchDocument(doc: DocLike, actor: SigningActor): boolean {
  return isAdmin(actor.role) && doc.requires_signature && BATCHABLE.includes(doc.status);
}

/** Wgranie podpisu ze szczegółów; dokument bez wymogu podpisu nie pokazuje tej akcji (RPC by ją przyjął). */
export function canAttachSigned(doc: DocLike, actor: SigningActor): boolean {
  return isAdmin(actor.role) && doc.requires_signature && SIGNABLE.includes(doc.status);
}

export function canMarkSent(doc: DocLike, actor: SigningActor): boolean {
  return isAdmin(actor.role) && doc.status === 'podpisany';
}

export function canDeleteDocument(actor: SigningActor): boolean {
  return isAdmin(actor.role);
}

/** Bieżący oryginał i bieżący plik podpisu dokumentu (z `files`). */
export function currentFiles(doc: Pick<SigningDocument, 'files'>): {
  original: SigningFile | null;
  signature: SigningFile | null;
} {
  const files = doc.files ?? [];
  return {
    original: files.find((f) => f.is_current && f.kind === 'oryginal') ?? null,
    signature: files.find((f) => f.is_current && f.kind !== 'oryginal') ?? null,
  };
}
