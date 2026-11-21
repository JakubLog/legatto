// Edge Function: device-login
// Logowanie z ekranu wyboru profilu na zaufanym komputerze: PIN trybu prywatnego zamiast hasła,
// potem zwykły ekran 2FA. Wywoływana bez sesji (klucz anon w Authorization).
//
// Zaufany komputer = para kluczy ECDSA P-256 zarejestrowana RPC register_trusted_device po pełnym
// logowaniu (aal2); klucz prywatny nieeksportowalny zostaje w przeglądarce (IndexedDB).
//
// Body:
//   { op: 'challenge', device_id }                    -> 200 { challenge }
//   { op: 'login', device_id, signature, pin }        -> 200 { token_hash }
//   { op: 'forget', device_id, signature }            -> 200 { success: true }
// Podpis (ECDSA P-256 / SHA-256, format IEEE P1363, base64url) obejmuje tekst
//   `legatto-trusted-device|<op>|<device_id>|<challenge>`; wyzwanie jest jednorazowe (60 s)
//   i zużywane przy każdej próbie, także nieudanej.
//
// Login: podpis -> konto (aktywne, bez bana, hasło ustawione, zweryfikowany TOTP) -> PIN przez
// privacy_pin_attempt (limit prób i blokada jak przy odsłanianiu ekranu) -> admin.generateLink
// (magiclink, bez wysyłki maila); przeglądarka od razu zużywa token_hash w verifyOtp i dostaje
// sesję aal1. Dostęp do danych wymaga dalej kodu TOTP (aal2) - urządzenie i PIN go nie zastępują.
//
// Błędy: { error, code } - code: unknown_device (401), bad_pin (401), pin_locked (423),
// pin_not_set (409), account_unavailable (403), bad_request (400), server_error (500).

import { createClient } from '@supabase/supabase-js';
import { corsHeadersFor } from '../_shared/cors.ts';
import { serviceAudit, UUID_RE } from '../_shared/auth.ts';

type Op = 'challenge' | 'login' | 'forget';

interface RequestBody {
  op?: unknown;
  device_id?: unknown;
  signature?: unknown;
  pin?: unknown;
}

interface ConsumedDevice {
  user_id: string;
  public_key: JsonWebKey;
  challenge: string;
  label: string;
}

// 64 bajty podpisu P1363 w base64url bez paddingu.
const SIGNATURE_RE = /^[A-Za-z0-9_-]{86}$/;
const PIN_RE = /^[0-9]{4,8}$/;

const UNKNOWN_DEVICE = 'Ten komputer nie jest już zaufany. Zaloguj się hasłem.';
const ACCOUNT_UNAVAILABLE = 'Zaloguj się hasłem i kodem 2FA.';

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function verifySignature(device: ConsumedDevice, op: Op, deviceId: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: device.public_key.x, y: device.public_key.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64UrlToBytes(signature),
      // Format jak w src/lib/trustedDevice.ts (signDeviceChallenge).
      new TextEncoder().encode(`legatto-trusted-device|${op}|${deviceId}|${device.challenge}`),
    );
  } catch (err) {
    console.error('device-login signature check error', err instanceof Error ? err.name : 'unknown');
    return false;
  }
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  const fail = (status: number, code: string, error: string) => json({ error, code }, status);

  if (req.method !== 'POST') {
    return fail(405, 'bad_request', 'Dozwolona metoda: POST');
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return fail(500, 'server_error', 'Brak konfiguracji środowiska');
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = (await req.json().catch(() => null)) as RequestBody | null;
    const op = body?.op;
    const deviceId = body?.device_id;
    if ((op !== 'challenge' && op !== 'login' && op !== 'forget') || typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) {
      return fail(400, 'bad_request', 'Niepełne dane (wymagane: op, device_id)');
    }

    if (op === 'challenge') {
      const { data, error } = await admin.rpc('service_trusted_device_challenge', { p_device_id: deviceId });
      if (error) {
        console.error('service_trusted_device_challenge error', error.code);
        return fail(500, 'server_error', 'Nie udało się rozpocząć logowania');
      }
      if (typeof data !== 'string') return fail(401, 'unknown_device', UNKNOWN_DEVICE);
      return json({ challenge: data }, 200);
    }

    const signature = body?.signature;
    if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) {
      return fail(400, 'bad_request', 'Niepełne dane (wymagane: signature)');
    }
    const pin = body?.pin;
    if (op === 'login' && (typeof pin !== 'string' || !PIN_RE.test(pin))) {
      return fail(400, 'bad_request', 'PIN musi mieć od 4 do 8 cyfr.');
    }

    const { data: consumed, error: consumeError } = await admin.rpc('service_trusted_device_consume', {
      p_device_id: deviceId,
    });
    if (consumeError) {
      console.error('service_trusted_device_consume error', consumeError.code);
      return fail(500, 'server_error', 'Nie udało się zweryfikować komputera');
    }
    const device = consumed as ConsumedDevice | null;
    if (!device || !(await verifySignature(device, op, deviceId, signature))) {
      return fail(401, 'unknown_device', UNKNOWN_DEVICE);
    }

    if (op === 'forget') {
      const { error } = await admin.from('trusted_devices').delete().eq('id', deviceId);
      if (error) {
        console.error('trusted_devices delete error', error.code);
        return fail(500, 'server_error', 'Nie udało się usunąć komputera');
      }
      await serviceAudit(admin, device.user_id, 'trusted_device.forget', 'trusted_device', deviceId, {
        label: device.label,
      });
      return json({ success: true }, 200);
    }

    // Konto: ten sam stan, który dopuszcza logowanie hasłem i 2FA.
    const [{ data: authUser, error: authError }, { data: profile, error: profileError }] = await Promise.all([
      admin.auth.admin.getUserById(device.user_id),
      admin.from('profiles').select('is_active, password_set, has_privacy_pin').eq('id', device.user_id).maybeSingle(),
    ]);
    if (authError || profileError) {
      console.error('device-login account lookup error', authError?.status ?? profileError?.code);
      return fail(500, 'server_error', 'Nie udało się sprawdzić konta');
    }
    // Ban GoTrue zakłada tylko dezaktywacja (is_active=false), a ta usuwa też urządzenia (revoke_user_access).
    const user = authUser?.user;
    const hasVerifiedTotp = (user?.factors ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified');
    if (!user?.email || !profile?.is_active || !profile.password_set || !hasVerifiedTotp) {
      return fail(403, 'account_unavailable', ACCOUNT_UNAVAILABLE);
    }
    if (!profile.has_privacy_pin) {
      return fail(409, 'pin_not_set', 'Konto nie ma PIN-u. Zaloguj się hasłem i ustaw PIN w Profilu.');
    }

    const { data: pinOk, error: pinError } = await admin.rpc('privacy_pin_attempt', {
      p_user_id: device.user_id,
      p_pin: pin,
    });
    if (pinError) {
      if (pinError.message?.includes('privacy_pin_locked')) {
        return fail(423, 'pin_locked', 'PIN zablokowany po zbyt wielu próbach. Zaloguj się hasłem.');
      }
      console.error('privacy_pin_attempt error', pinError.code);
      return fail(500, 'server_error', 'Nie udało się sprawdzić PIN-u');
    }
    if (pinOk !== true) {
      return fail(401, 'bad_pin', 'Nieprawidłowy PIN.');
    }

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error('device-login generateLink error', linkError?.status);
      return fail(500, 'server_error', 'Nie udało się zalogować');
    }

    const { error: touchError } = await admin
      .from('trusted_devices')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', deviceId);
    if (touchError) console.error('trusted_devices touch error', touchError.code);
    await serviceAudit(admin, device.user_id, 'trusted_device.login', 'trusted_device', deviceId, {
      label: device.label,
    });

    return json({ token_hash: tokenHash }, 200);
  } catch (err) {
    console.error('device-login unexpected error', err instanceof Error ? err.name : 'unknown');
    return fail(500, 'server_error', 'Błąd serwera');
  }
});
