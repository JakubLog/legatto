import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POLICY_FILE, selfhostAuthPolicy, serializePolicy } from './auth-policy.mjs';
import { PASSWORD_REQUIRED_CHARACTERS } from './policy.mjs';

describe('supabase/selfhost/auth-policy.json', () => {
  it('jest zgodny z policy.mjs (node scripts/instances/auth-policy.mjs --write)', () => {
    expect(fs.readFileSync(POLICY_FILE, 'utf8')).toBe(serializePolicy(selfhostAuthPolicy()));
  });

  it('trzyma wartości runtime GoTrue (czasy jako Go duration, znaki hasła po dekodowaniu JS)', () => {
    const { env, origin_env: originEnv } = selfhostAuthPolicy();
    expect(env.GOTRUE_SESSIONS_TIMEBOX).toBe('720h');
    expect(env.GOTRUE_SESSIONS_INACTIVITY_TIMEOUT).toBe('168h');
    expect(env.GOTRUE_PASSWORD_REQUIRED_CHARACTERS).toBe(PASSWORD_REQUIRED_CHARACTERS);
    expect(env.GOTRUE_PASSWORD_REQUIRED_CHARACTERS).toContain("'\\\\:\"");
    expect(env.GOTRUE_DISABLE_SIGNUP).toBe('true');
    expect(originEnv.GOTRUE_URI_ALLOW_LIST).toBe('{origin}/login,{admin_origin}/login');
  });
});
