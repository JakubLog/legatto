// PKCE (RFC 7636) dla OAuth 2.1 Authorization Code - tylko metoda S256,
// jak wymaga serwer biura (api/oauth/authorize.ts, api/oauth/token.ts).

import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 §4.1: 43-128 znaków z zestawu unreserved. */
export const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** 32 losowe bajty -> 43 znaki base64url (zalecenie RFC 7636 §4.1). */
export function createCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

/** code_challenge = BASE64URL(SHA256(ASCII(code_verifier))). */
export function codeChallengeS256(verifier) {
  if (typeof verifier !== 'string' || !CODE_VERIFIER_RE.test(verifier)) {
    throw new TypeError('Niepoprawny code_verifier (RFC 7636 §4.1)');
  }
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Losowy, nieprzewidywalny parametr `state` (ochrona przed CSRF na callbacku). */
export function createState() {
  return randomBytes(24).toString('base64url');
}
