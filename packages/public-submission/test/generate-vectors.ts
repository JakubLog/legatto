// Generator test/vectors.json (deterministyczne klucze testowe, NIE produkcyjne).
// Uruchomienie (z katalogu repo):
//   pnpm exec esbuild packages/public-submission/test/generate-vectors.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/gen-vectors.mjs && node /tmp/gen-vectors.mjs <libsodium-vectors.json> \
//     > packages/public-submission/test/vectors.json
// <libsodium-vectors.json> - lista {recipient_secret, recipient_public, message, sealed} wygenerowana
// przez libsodium-wrappers 0.8.4 (crypto_box_keypair + crypto_box_seal), przepisywana bez zmian.

import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  buildEnvelope,
  buildSelftestRequest,
  encryptPlaintext,
  keyId,
  KIND_SELFTEST,
  KIND_SUBMISSION,
  pad,
  sealWithEphemeral,
  toBase64,
  x25519PublicKey,
  type SubmissionPlaintext,
} from '../src/index';

const seed = (label: string) => sha256(new TextEncoder().encode(`legatto-test-vector:${label}`));

const officeSecret = seed('office-x25519');
const officePublic = x25519PublicKey(officeSecret);
const signerSeed = seed('worker-ed25519');
const selftestSeed = seed('selftest-ed25519');

const deterministicSeal = sealWithEphemeral(new TextEncoder().encode('Legatto sealed box'), officePublic, seed('ephemeral'));

const submission: SubmissionPlaintext = {
  v: 1,
  id: '6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  ts: '2026-11-21T12:00:00.000Z',
  kind: 'submission',
  site: 'jan-kowalski.pl',
  form: {
    reporter_name: 'Jan Testowy',
    reporter_email: 'jan@example.pl',
    reporter_phone: null,
    powiat_id: 1,
    gmina_id: null,
    category_id: 3,
    title: 'Dziura w drodze gminnej',
    description: 'Na drodze przy szkole jest głęboka dziura.\nProszę o interwencję.',
    rodo_consent: true,
    consent_newsletter: false,
    consent_contacts_db: false,
  },
};
const selftest: SubmissionPlaintext = {
  v: 1,
  id: '0b5a3c1e-2d4f-4a6b-9c8d-7e6f5a4b3c2d',
  ts: '2026-11-21T12:00:00.000Z',
  kind: 'selftest',
  site: 'jan-kowalski.pl',
  form: null,
  marker: '0123456789abcdef0123456789abcdef',
  mode: 'ping',
};
const meta = { v: 1 as const, ip_hash: 'a'.repeat(64), ua: 'Mozilla/5.0', turnstile_ts: '2026-11-21T12:00:00.000Z', release: '1.0.0' };

const submissionCt = encryptPlaintext(submission, officePublic);
const envelope = buildEnvelope({
  kind: KIND_SUBMISSION,
  officePublic,
  signerSeed,
  receivedAt: Date.parse('2026-11-21T12:00:01.000Z'),
  meta,
  ct: submissionCt,
});
const selftestCt = encryptPlaintext(selftest, officePublic);
const selftestRequest = buildSelftestRequest(
  selftestCt,
  keyId(officePublic),
  selftestSeed,
  '2026-11-21T12:00:00.000Z',
  'fedcba9876543210fedcba9876543210',
);
const selftestEnvelope = buildEnvelope({
  kind: KIND_SELFTEST,
  officePublic,
  signerSeed,
  receivedAt: Date.parse('2026-11-21T12:00:01.000Z'),
  meta: { v: 1, ip_hash: '0'.repeat(64), ua: 'selftest', turnstile_ts: null, release: '1.0.0' },
  ct: selftestCt,
});

const libsodium = JSON.parse(readFileSync(process.argv[2], 'utf8')) as unknown[];

process.stdout.write(
  `${JSON.stringify(
    {
      note: 'Klucze testowe (deterministyczne, nie produkcyjne). Generator: test/generate-vectors.ts.',
      keys: {
        office_x25519_secret: toBase64(officeSecret),
        office_x25519_public: toBase64(officePublic),
        office_kid: keyId(officePublic),
        worker_ed25519_seed: toBase64(signerSeed),
        worker_ed25519_public: toBase64(ed25519.getPublicKey(signerSeed)),
        worker_kid: keyId(ed25519.getPublicKey(signerSeed)),
        selftest_ed25519_seed: toBase64(selftestSeed),
        selftest_ed25519_public: toBase64(ed25519.getPublicKey(selftestSeed)),
      },
      pad: { input: 'abc', size: 16, output: toBase64(pad(new TextEncoder().encode('abc'), 16)) },
      libsodium_sealed: libsodium,
      noble_sealed_deterministic: {
        recipient_public: toBase64(officePublic),
        ephemeral_secret: toBase64(seed('ephemeral')),
        message: toBase64(new TextEncoder().encode('Legatto sealed box')),
        sealed: toBase64(deterministicSeal),
      },
      submission: { plaintext: submission, meta, envelope_b64: toBase64(envelope) },
      selftest: { plaintext: selftest, request: selftestRequest, envelope_b64: toBase64(selftestEnvelope) },
    },
    null,
    1,
  )}\n`,
);
