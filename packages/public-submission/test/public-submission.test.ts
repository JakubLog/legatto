import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import vectors from './vectors.json';
import {
  buildEnvelope,
  buildSubmitRequest,
  ENVELOPE_SIZE,
  EnvelopeRejected,
  FORM_CT_SIZE,
  fromBase64,
  KIND_SUBMISSION,
  keyId,
  openEnvelope,
  pad,
  parseEnvelope,
  parseFormKey,
  plainTextProblem,
  seal,
  sealOpen,
  sealWithEphemeral,
  selftestSignedBytes,
  submissionFormSchema,
  toBase64,
  unpad,
  verifyEnvelopeSignature,
  x25519PublicKey,
  x25519RandomSecret,
  type EnvelopeMeta,
  type SubmissionForm,
  type SubmissionPlaintext,
} from '../src/index';

const officeSecret = fromBase64(vectors.keys.office_x25519_secret);
const officePublic = fromBase64(vectors.keys.office_x25519_public);
const workerSeed = fromBase64(vectors.keys.worker_ed25519_seed);
const workerPublic = fromBase64(vectors.keys.worker_ed25519_public);
const signers = new Map([[vectors.keys.worker_kid, workerPublic]]);
const officeKeys = new Map([[vectors.keys.office_kid, officeSecret]]);
const meta = vectors.submission.meta as EnvelopeMeta;

function rejectionReason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof EnvelopeRejected) return err.reason;
    throw err;
  }
  throw new Error('oczekiwano odrzucenia');
}

describe('sealed box (libsodium crypto_box_seal)', () => {
  it('otwiera szyfrogramy z libsodium', () => {
    for (const v of vectors.libsodium_sealed) {
      const opened = sealOpen(fromBase64(v.sealed), fromBase64(v.recipient_secret));
      expect(toBase64(opened)).toBe(v.message);
      expect(toBase64(x25519PublicKey(fromBase64(v.recipient_secret)))).toBe(v.recipient_public);
    }
  });

  it('daje deterministyczny wynik przy ustalonym kluczu efemerycznym (wektor sprawdzony libsodium)', () => {
    const v = vectors.noble_sealed_deterministic;
    const sealed = sealWithEphemeral(fromBase64(v.message), fromBase64(v.recipient_public), fromBase64(v.ephemeral_secret));
    expect(toBase64(sealed)).toBe(v.sealed);
  });

  it('round-trip i odrzucenie złego klucza lub zmienionego bajtu', () => {
    const secret = x25519RandomSecret();
    const msg = new TextEncoder().encode('treść zgłoszenia');
    const sealed = seal(msg, x25519PublicKey(secret));
    expect(sealed.length).toBe(msg.length + 48);
    expect(new TextDecoder().decode(sealOpen(sealed, secret))).toBe('treść zgłoszenia');
    expect(() => sealOpen(sealed, x25519RandomSecret())).toThrow();
    const tampered = sealed.slice();
    tampered[60] ^= 1;
    expect(() => sealOpen(tampered, secret)).toThrow();
  });
});

describe('pad/unpad', () => {
  it('zgodne z wektorem i odrzuca złe dopełnienie', () => {
    const padded = pad(new TextEncoder().encode(vectors.pad.input), vectors.pad.size);
    expect(toBase64(padded)).toBe(vectors.pad.output);
    expect(new TextDecoder().decode(unpad(padded, 16))).toBe('abc');
    const bad = padded.slice();
    bad[15] = 1;
    expect(() => unpad(bad, 16)).toThrow();
    expect(() => pad(new Uint8Array(13), 16)).toThrow();
  });
});

describe('schemat formularza (czysty tekst)', () => {
  const base = vectors.submission.plaintext.form as SubmissionForm;

  it('przyjmuje poprawny formularz i normalizuje do NFC', () => {
    const parsed = submissionFormSchema.parse({ ...base, title: '  Zgłoszenie e\u0301  ' });
    expect(parsed.title).toBe('Zgłoszenie é');
  });

  it('odrzuca znaki sterujące, bidi, BOM i nową linię w polach jednoliniowych', () => {
    expect(submissionFormSchema.safeParse({ ...base, reporter_name: 'Jan\u202eTest' }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, title: 'Tytuł\nzłamany' }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, title: 'Tytuł\ufeff zgłoszenia' }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, description: `${'a'.repeat(30)}\u0007` }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, description: `${'a'.repeat(30)}\n\tdalej` }).success).toBe(true);
    expect(plainTextProblem('x\ud800y', true)).not.toBeNull();
  });

  it('granice długości i wymagany kontakt', () => {
    expect(submissionFormSchema.safeParse({ ...base, title: 'abcd' }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, title: 'a'.repeat(201) }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, description: 'a'.repeat(5001) }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, reporter_email: null, reporter_phone: null }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, reporter_email: null, reporter_phone: '+48 600 000 000' }).success).toBe(true);
    expect(submissionFormSchema.safeParse({ ...base, powiat_id: 1.5 }).success).toBe(false);
    expect(submissionFormSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('najdłuższy dopuszczalny formularz mieści się w dopełnieniu', () => {
    const longest: SubmissionPlaintext = {
      ...(vectors.submission.plaintext as SubmissionPlaintext & { kind: 'submission' }),
      form: {
        ...base,
        reporter_name: '\u{10FFFF}'.repeat(50),
        reporter_email: `${'a'.repeat(240)}@example.pl`,
        reporter_phone: '+'.padEnd(20, '1'),
        title: 'ł'.repeat(200),
        description: '\u{1F600}'.repeat(2500),
      },
    };
    const { request } = buildSubmitRequest(longest, { kid: vectors.keys.office_kid, publicKey: officePublic }, 't', '');
    expect(fromBase64(request.ct).length).toBe(FORM_CT_SIZE);
  });
});

describe('koperta v1', () => {
  const envelopeBytes = fromBase64(vectors.submission.envelope_b64);

  it('wektor: rozmiar, podpis, deszyfracja i treść', () => {
    expect(envelopeBytes.length).toBe(ENVELOPE_SIZE);
    const parts = parseEnvelope(envelopeBytes);
    expect(parts.officeKid).toBe(vectors.keys.office_kid);
    expect(parts.signerKid).toBe(vectors.keys.worker_kid);
    verifyEnvelopeSignature(parts, signers);
    const opened = openEnvelope(parts, officeKeys);
    expect(opened.frame).toEqual(vectors.submission.plaintext);
    expect(opened.form?.title).toBe(vectors.submission.plaintext.form.title);
    expect(opened.invalid).toBeNull();
    expect(opened.meta).toEqual(vectors.submission.meta);
  });

  it('selftest: wektor koperty i podpis żądania', () => {
    const parts = parseEnvelope(fromBase64(vectors.selftest.envelope_b64));
    verifyEnvelopeSignature(parts, signers);
    const opened = openEnvelope(parts, officeKeys);
    expect(opened.frame.kind).toBe('selftest');
    const req = vectors.selftest.request;
    const msg = selftestSignedBytes(req.ts, req.nonce, fromBase64(req.ct));
    expect(ed25519.verify(fromBase64(req.sig), msg, fromBase64(vectors.keys.selftest_ed25519_public))).toBe(true);
  });

  it('odrzuca zły rozmiar, magic, wersję, rodzaj', () => {
    expect(rejectionReason(() => parseEnvelope(envelopeBytes.subarray(1)))).toBe('bad_size');
    const badMagic = envelopeBytes.slice();
    badMagic[0] = 0x58;
    expect(rejectionReason(() => parseEnvelope(badMagic))).toBe('bad_magic');
    const badVersion = envelopeBytes.slice();
    badVersion[4] = 2;
    expect(rejectionReason(() => parseEnvelope(badVersion))).toBe('bad_version');
    const badKind = envelopeBytes.slice();
    badKind[5] = 9;
    expect(rejectionReason(() => parseEnvelope(badKind))).toBe('bad_kind');
  });

  it('odrzuca nieznanego sygnatariusza i zmieniony bajt (podpis)', () => {
    expect(rejectionReason(() => verifyEnvelopeSignature(parseEnvelope(envelopeBytes), new Map()))).toBe('unknown_signer');
    for (const offset of [22, 100, 700, ENVELOPE_SIZE - 1]) {
      const tampered = envelopeBytes.slice();
      tampered[offset] ^= 1;
      expect(rejectionReason(() => verifyEnvelopeSignature(parseEnvelope(tampered), signers))).toBe('bad_signature');
    }
  });

  it('odrzuca nieznany klucz biura i deszyfrację innym kluczem', () => {
    const parts = parseEnvelope(envelopeBytes);
    expect(rejectionReason(() => openEnvelope(parts, new Map()))).toBe('unknown_office_kid');
    expect(rejectionReason(() => openEnvelope(parts, new Map([[parts.officeKid, x25519RandomSecret()]])))).toBe(
      'decrypt_failed',
    );
  });

  it('niepoprawna treść formularza = invalid (nie kwarantanna); niezgodny rodzaj = bad_plaintext', () => {
    const plaintext = { ...vectors.submission.plaintext, form: { ...vectors.submission.plaintext.form, title: 'abc' } };
    const ct = seal(pad(new TextEncoder().encode(JSON.stringify(plaintext)), 24_576), officePublic);
    const env = buildEnvelope({ kind: KIND_SUBMISSION, officePublic, signerSeed: workerSeed, receivedAt: 1, meta, ct });
    const opened = openEnvelope(parseEnvelope(env), officeKeys);
    expect(opened.form).toBeNull();
    expect(opened.invalid).toBe('title');

    const selftestCt = fromBase64(vectors.selftest.request.ct);
    const mixed = buildEnvelope({ kind: KIND_SUBMISSION, officePublic, signerSeed: workerSeed, receivedAt: 1, meta, ct: selftestCt });
    expect(rejectionReason(() => openEnvelope(parseEnvelope(mixed), officeKeys))).toBe('bad_plaintext');
  });

  it('parseFormKey sprawdza zgodność kid z kluczem', () => {
    const key = { v: 1, kid: keyId(officePublic), x25519: toBase64(officePublic) };
    expect(parseFormKey(key).kid).toBe(vectors.keys.office_kid);
    expect(() => parseFormKey({ ...key, kid: '0'.repeat(16) })).toThrow();
  });
});
