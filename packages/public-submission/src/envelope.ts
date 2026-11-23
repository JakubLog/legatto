// Koperta v1 (wiadomość w Cloudflare Queues, stały rozmiar 25 278 B):
//
// | offset | rozmiar | pole                                                                     |
// |      0 |       4 | magic "LGF1"                                                             |
// |      4 |       1 | version = 1                                                              |
// |      5 |       1 | kind: 1 submission, 2 selftest                                           |
// |      6 |       8 | office_kid = SHA-256(office_x25519_pub)[0..8]                            |
// |     14 |       8 | signer_kid = SHA-256(worker_ed25519_pub)[0..8]                           |
// |     22 |       8 | received_at: u64be, ms (zegar Workera)                                   |
// |     30 |      64 | sig = Ed25519(worker, "legatto-forms-v1\0" ‖ bytes[0..30] ‖ meta_ct ‖ ct) |
// |     94 |     560 | meta_ct = seal(pad512(meta JSON), office_x25519_pub)                     |
// |    654 |  24 624 | ct = seal(pad24576(plaintext JSON), office_x25519_pub) - z przeglądarki  |
//
// Worker (legatto-infra/worker) buduje kopertę; legatto-intake process ją weryfikuje i otwiera.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  concatBytes,
  fromBase64,
  fromUtf8,
  readU64BE,
  toBase64,
  toHex,
  utf8,
  writeU64BE,
} from './bytes';
import {
  ENVELOPE_CT_OFFSET,
  ENVELOPE_HEADER_SIZE,
  ENVELOPE_MAGIC,
  ENVELOPE_META_OFFSET,
  ENVELOPE_SIG_CONTEXT,
  ENVELOPE_SIZE,
  ENVELOPE_VERSION,
  FORM_CT_SIZE,
  FORM_PLAINTEXT_SIZE,
  KIND_SELFTEST,
  KIND_SUBMISSION,
  META_CT_SIZE,
  META_PLAINTEXT_SIZE,
  SELFTEST_SIG_CONTEXT,
} from './constants';
import { pad, unpad } from './pad';
import {
  formKeySchema,
  metaSchema,
  plaintextEnvelopeSchema,
  plaintextSchema,
  submissionFormSchema,
  type EnvelopeMeta,
  type FormKey,
  type PlaintextEnvelope,
  type SubmissionForm,
  type SubmissionPlaintext,
} from './schema';
import { seal, sealOpen } from './sealedbox';

/** Identyfikator klucza: pierwsze 8 B SHA-256 klucza publicznego (hex, 16 znaków). */
export function keyId(publicKey: Uint8Array): string {
  return toHex(sha256(publicKey).subarray(0, 8));
}

/** Numer potwierdzenia dla zgłaszającego: 8 znaków hex SHA-256 szyfrogramu formularza. */
export function submissionRef(ct: Uint8Array): string {
  return toHex(sha256(ct)).slice(0, 8);
}

export function parseFormKey(raw: unknown): { kid: string; publicKey: Uint8Array } {
  const key: FormKey = formKeySchema.parse(raw);
  const publicKey = fromBase64(key.x25519);
  if (publicKey.length !== 32 || keyId(publicKey) !== key.kid) throw new Error('form-key: kid nie pasuje do klucza');
  return { kid: key.kid, publicKey };
}

/** Szyfruje plaintext formularza kluczem biura (przeglądarka, legatto-intake selftest). */
export function encryptPlaintext(plaintext: SubmissionPlaintext, officePublic: Uint8Array): Uint8Array {
  const json = utf8(JSON.stringify(plaintextSchema.parse(plaintext)));
  return seal(pad(json, FORM_PLAINTEXT_SIZE), officePublic);
}

/** Body POST /api/submit (przeglądarka → Worker). */
export interface SubmitRequest {
  v: 1;
  kid: string;
  ct: string;
  turnstile: string;
  hp: string;
}

export function buildSubmitRequest(
  plaintext: SubmissionPlaintext,
  formKey: { kid: string; publicKey: Uint8Array },
  turnstile: string,
  honeypot: string,
): { request: SubmitRequest; ref: string } {
  const ct = encryptPlaintext(plaintext, formKey.publicKey);
  return {
    request: { v: 1, kid: formKey.kid, ct: toBase64(ct), turnstile, hp: honeypot },
    ref: submissionRef(ct),
  };
}

/** Body POST /api/selftest (legatto-intake selftest → Worker), podpisane kluczem selftest biura. */
export interface SelftestRequest {
  v: 1;
  kid: string;
  ct: string;
  ts: string;
  nonce: string;
  sig: string;
}

/** Bajty podpisu żądania selftest: kontekst ‖ ts ‖ 0x00 ‖ nonce ‖ 0x00 ‖ SHA-256(ct). */
export function selftestSignedBytes(ts: string, nonce: string, ct: Uint8Array): Uint8Array {
  return concatBytes(utf8(SELFTEST_SIG_CONTEXT), utf8(ts), new Uint8Array([0]), utf8(nonce), new Uint8Array([0]), sha256(ct));
}

export function buildSelftestRequest(
  ct: Uint8Array,
  officeKid: string,
  selftestSeed: Uint8Array,
  ts: string,
  nonce: string,
): SelftestRequest {
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('nonce: 32 znaki hex');
  const sig = ed25519.sign(selftestSignedBytes(ts, nonce, ct), selftestSeed);
  return { v: 1, kid: officeKid, ct: toBase64(ct), ts, nonce, sig: toBase64(sig) };
}

export interface EnvelopeParts {
  kind: typeof KIND_SUBMISSION | typeof KIND_SELFTEST;
  officeKid: string;
  signerKid: string;
  receivedAt: number;
  sig: Uint8Array;
  metaCt: Uint8Array;
  ct: Uint8Array;
  /** Bajty objęte podpisem (bez kontekstu). */
  signed: Uint8Array;
}

export type EnvelopeError =
  | 'bad_size'
  | 'bad_magic'
  | 'bad_version'
  | 'bad_kind'
  | 'unknown_signer'
  | 'bad_signature'
  | 'unknown_office_kid'
  | 'decrypt_failed'
  | 'bad_plaintext';

export class EnvelopeRejected extends Error {
  constructor(readonly reason: EnvelopeError, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'EnvelopeRejected';
  }
}

/** Składa kopertę (implementacja referencyjna Workera; używana w testach i wektorach). */
export function buildEnvelope(input: {
  kind: typeof KIND_SUBMISSION | typeof KIND_SELFTEST;
  officePublic: Uint8Array;
  signerSeed: Uint8Array;
  receivedAt: number;
  meta: EnvelopeMeta;
  ct: Uint8Array;
}): Uint8Array {
  if (input.ct.length !== FORM_CT_SIZE) throw new Error('ct: zły rozmiar');
  const metaCt = seal(pad(utf8(JSON.stringify(metaSchema.parse(input.meta))), META_PLAINTEXT_SIZE), input.officePublic);
  const header = new Uint8Array(ENVELOPE_HEADER_SIZE);
  header.set(utf8(ENVELOPE_MAGIC), 0);
  header[4] = ENVELOPE_VERSION;
  header[5] = input.kind;
  header.set(sha256(input.officePublic).subarray(0, 8), 6);
  header.set(sha256(ed25519.getPublicKey(input.signerSeed)).subarray(0, 8), 14);
  writeU64BE(header, 22, input.receivedAt);
  const sig = ed25519.sign(concatBytes(utf8(ENVELOPE_SIG_CONTEXT), header, metaCt, input.ct), input.signerSeed);
  return concatBytes(header, sig, metaCt, input.ct);
}

/** Rozbiór koperty bez kryptografii (rozmiar, magic, wersja, rodzaj). */
export function parseEnvelope(bytes: Uint8Array): EnvelopeParts {
  if (bytes.length !== ENVELOPE_SIZE) throw new EnvelopeRejected('bad_size', String(bytes.length));
  if (fromUtf8(bytes.subarray(0, 4)) !== ENVELOPE_MAGIC) throw new EnvelopeRejected('bad_magic');
  if (bytes[4] !== ENVELOPE_VERSION) throw new EnvelopeRejected('bad_version', String(bytes[4]));
  const kind = bytes[5];
  if (kind !== KIND_SUBMISSION && kind !== KIND_SELFTEST) throw new EnvelopeRejected('bad_kind', String(kind));
  const header = bytes.subarray(0, ENVELOPE_HEADER_SIZE);
  const metaCt = bytes.subarray(ENVELOPE_META_OFFSET, ENVELOPE_META_OFFSET + META_CT_SIZE);
  const ct = bytes.subarray(ENVELOPE_CT_OFFSET);
  return {
    kind,
    officeKid: toHex(bytes.subarray(6, 14)),
    signerKid: toHex(bytes.subarray(14, 22)),
    receivedAt: readU64BE(bytes, 22),
    sig: bytes.subarray(ENVELOPE_HEADER_SIZE, ENVELOPE_META_OFFSET),
    metaCt,
    ct,
    signed: concatBytes(header, metaCt, ct),
  };
}

/** Podpis Workera: klucz z allowlisty (signer_kid → klucz publiczny Ed25519). */
export function verifyEnvelopeSignature(parts: EnvelopeParts, signers: ReadonlyMap<string, Uint8Array>): void {
  const signer = signers.get(parts.signerKid);
  if (!signer) throw new EnvelopeRejected('unknown_signer', parts.signerKid);
  let ok = false;
  try {
    ok = ed25519.verify(parts.sig, concatBytes(utf8(ENVELOPE_SIG_CONTEXT), parts.signed), signer);
  } catch {
    ok = false;
  }
  if (!ok) throw new EnvelopeRejected('bad_signature');
}

export interface OpenedEnvelope {
  frame: PlaintextEnvelope;
  /** Formularz po walidacji schematem; null dla selftest albo gdy treść jest niepoprawna. */
  form: SubmissionForm | null;
  /** Pierwsze niepoprawne pole formularza (odrzucenie walidacyjne, nie kwarantanna). */
  invalid: string | null;
  meta: EnvelopeMeta;
  ref: string;
}

/** Deszyfracja i walidacja plaintextu (klucze biura: office_kid → klucz prywatny X25519). */
export function openEnvelope(parts: EnvelopeParts, officeKeys: ReadonlyMap<string, Uint8Array>): OpenedEnvelope {
  const secret = officeKeys.get(parts.officeKid);
  if (!secret) throw new EnvelopeRejected('unknown_office_kid', parts.officeKid);
  let metaRaw: Uint8Array;
  let formRaw: Uint8Array;
  try {
    metaRaw = unpad(sealOpen(parts.metaCt, secret), META_PLAINTEXT_SIZE);
    formRaw = unpad(sealOpen(parts.ct, secret), FORM_PLAINTEXT_SIZE);
  } catch (err) {
    throw new EnvelopeRejected('decrypt_failed', err instanceof Error ? err.message : undefined);
  }
  let frame: PlaintextEnvelope;
  let meta: EnvelopeMeta;
  try {
    meta = metaSchema.parse(JSON.parse(fromUtf8(metaRaw)));
    frame = plaintextEnvelopeSchema.parse(JSON.parse(fromUtf8(formRaw)));
  } catch {
    throw new EnvelopeRejected('bad_plaintext');
  }
  const expectedKind = parts.kind === KIND_SELFTEST ? 'selftest' : 'submission';
  if (frame.kind !== expectedKind) throw new EnvelopeRejected('bad_plaintext', 'kind');
  const ref = submissionRef(parts.ct);
  if (frame.kind === 'selftest') {
    return { frame, form: null, invalid: null, meta, ref };
  }
  const parsed = submissionFormSchema.safeParse(frame.form);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { frame, form: null, invalid: typeof field === 'string' ? field : 'form', meta, ref };
  }
  return { frame, form: parsed.data, invalid: null, meta, ref };
}
