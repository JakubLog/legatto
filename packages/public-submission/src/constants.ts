// Stałe formatu formularza strony posła (envelope v1). Kontrakt z Workerem w legatto-infra
// (worker/): zmiana któregokolwiek rozmiaru = nowa wersja koperty.

/** Rozmiar plaintextu formularza po dopełnieniu: u32be(len) ‖ JSON ‖ 0x00… */
export const FORM_PLAINTEXT_SIZE = 24_576;
/** Narzut sealed boxa (libsodium crypto_box_seal): klucz efemeryczny 32 B + tag Poly1305 16 B. */
export const SEAL_OVERHEAD = 48;
/** Szyfrogram formularza z przeglądarki. */
export const FORM_CT_SIZE = FORM_PLAINTEXT_SIZE + SEAL_OVERHEAD; // 24 624
/** Metadane Workera (hash IP, UA) po dopełnieniu. */
export const META_PLAINTEXT_SIZE = 512;
export const META_CT_SIZE = META_PLAINTEXT_SIZE + SEAL_OVERHEAD; // 560

export const ENVELOPE_MAGIC = 'LGF1';
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_HEADER_SIZE = 30; // magic 4, version 1, kind 1, office_kid 8, signer_kid 8, received_at 8
export const ENVELOPE_SIG_SIZE = 64;
export const ENVELOPE_META_OFFSET = ENVELOPE_HEADER_SIZE + ENVELOPE_SIG_SIZE; // 94
export const ENVELOPE_CT_OFFSET = ENVELOPE_META_OFFSET + META_CT_SIZE; // 654
export const ENVELOPE_SIZE = ENVELOPE_CT_OFFSET + FORM_CT_SIZE; // 25 278

export const KIND_SUBMISSION = 1;
export const KIND_SELFTEST = 2;

/** Kontekst podpisu koperty (Ed25519 Workera). */
export const ENVELOPE_SIG_CONTEXT = 'legatto-forms-v1\0';
/** Kontekst podpisu żądania selftest (Ed25519 klucza selftest biura). */
export const SELFTEST_SIG_CONTEXT = 'legatto-selftest-v1\0';

/** Koperty starsze niż retencja kolejki (14 dni) + zapas są odrzucane. */
export const MAX_ENVELOPE_AGE_MS = 16 * 24 * 3600 * 1000;
/** Okno czasu żądania selftest (Worker). */
export const SELFTEST_MAX_SKEW_MS = 120_000;
