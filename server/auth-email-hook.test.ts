import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthEmails,
  handleSendEmailHook,
  parseHookSecrets,
  renderInviteTemplate,
  type AuthEmail,
  type SendEmailHookDeps,
} from './auth-email-hook';

const KEY = randomBytes(32);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW = 1_800_000_000;
const ORIGIN = 'https://app.biuro.example';

function signed(body: string, opts: { key?: Buffer; ts?: number; id?: string } = {}) {
  const id = opts.id ?? 'msg_1';
  const ts = String(opts.ts ?? NOW);
  const sig = createHmac('sha256', opts.key ?? KEY).update(`${id}.${ts}.${body}`).digest('base64');
  return { headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body: Buffer.from(body) };
}

function deps(sent: AuthEmail[]): SendEmailHookDeps {
  return {
    secrets: parseHookSecrets(SECRET),
    inviteTemplate: '<p>Witaj{{ if .Data.full_name }}, {{ .Data.full_name }}{{ end }}! <a href="{{ .ConfirmationURL }}">x</a> {{ .SiteURL }}</p>',
    now: () => NOW,
    origin: () => ORIGIN,
    send: async (email) => {
      sent.push(email);
    },
  };
}

const invite = JSON.stringify({
  user: { email: 'jan@example.pl', user_metadata: { full_name: 'Jan <b>K</b>' } },
  email_data: { token_hash: 'th1', redirect_to: 'https://app.biuro.example/login', email_action_type: 'invite' },
});

describe('podpis Standard Webhooks', () => {
  it('poprawny podpis → wysyłka zaproszenia z szablonu', async () => {
    const sent: AuthEmail[] = [];
    const { headers, body } = signed(invite);
    const result = await handleSendEmailHook(deps(sent), headers, body);
    expect(result).toEqual({ status: 200, body: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('jan@example.pl');
    expect(sent[0].html).toContain('Witaj, Jan &lt;b&gt;K&lt;/b&gt;!');
    expect(sent[0].html).toContain(
      'href="https://app.biuro.example/auth/v1/verify?token=th1&amp;type=invite&amp;redirect_to=https%3A%2F%2Fapp.biuro.example%2Flogin"',
    );
  });

  it('obcy klucz, zmieniona treść, stary znacznik czasu → 401 bez wysyłki', async () => {
    const sent: AuthEmail[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const foreign = signed(invite, { key: randomBytes(32) });
    expect((await handleSendEmailHook(deps(sent), foreign.headers, foreign.body)).status).toBe(401);
    const tampered = signed(invite);
    expect((await handleSendEmailHook(deps(sent), tampered.headers, Buffer.from(invite.replace('jan@', 'eve@')))).status).toBe(401);
    const old = signed(invite, { ts: NOW - 301 });
    expect((await handleSendEmailHook(deps(sent), old.headers, old.body)).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('niepoprawny format sekretu jest odrzucany', () => {
    expect(() => parseHookSecrets('whsec_abc')).toThrow();
    expect(parseHookSecrets(`${SECRET}|${SECRET}`)).toHaveLength(2);
    expect(parseHookSecrets('')).toEqual([]);
  });
});

describe('treść wiadomości', () => {
  it('bezpieczna zmiana adresu: dwa maile z odwróconymi hashami', () => {
    const emails = buildAuthEmails(
      {
        user: { email: 'stary@example.pl', new_email: 'nowy@example.pl' },
        email_data: { email_action_type: 'email_change', token_hash: 'for-new', token_hash_new: 'for-current' },
      },
      ORIGIN,
      '',
    );
    expect(emails.map((e) => [e.to, /token=([^&]+)/.exec(e.text)?.[1]])).toEqual([
      ['stary@example.pl', 'for-current'],
      ['nowy@example.pl', 'for-new'],
    ]);
  });

  it('reset hasła i kod reautoryzacji', () => {
    const [recovery] = buildAuthEmails({ user: { email: 'a@b.pl' }, email_data: { email_action_type: 'recovery', token_hash: 'h' } }, ORIGIN, '');
    expect(recovery.subject).toBe('Ustawienie nowego hasła');
    expect(recovery.text).toContain(`${ORIGIN}/auth/v1/verify?token=h&type=recovery`);
    const [reauth] = buildAuthEmails({ user: { email: 'a@b.pl' }, email_data: { email_action_type: 'reauthentication', token: '123456' } }, ORIGIN, '');
    expect(reauth.html).toContain('123456');
  });

  it('nieznany rodzaj → 422', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { headers, body } = signed(JSON.stringify({ user: { email: 'a@b.pl' }, email_data: { email_action_type: 'x', token_hash: 'h' } }));
    expect((await handleSendEmailHook(deps([]), headers, body)).status).toBe(422);
  });

  it('szablon bez imienia usuwa blok warunkowy', () => {
    expect(renderInviteTemplate('Witaj{{ if .Data.full_name }}, {{ .Data.full_name }}{{ end }}!', 'u', 's', '')).toBe('Witaj!');
  });
});
