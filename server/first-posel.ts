// Pierwszy Poseł na nowej instancji (VPS): konto Auth + profil z rolą `posel`. Kolejne konta zakłada
// Poseł w panelu (admin-create-user). Uruchamiane w kontenerze app (env z service_role):
//
//   node /app/server/first-posel.mjs --email <adres> --name "<imię i nazwisko>" --delivery email|link
//
//   --delivery email  zaproszenie mailem (hook Auth → Resend; wymaga klucza Resend i nadawcy w bazie),
//   --delivery link   jednorazowy link ustawienia hasła na stdout - do przekazania Posłowi osobiście,
//                     gdy wysyłka e-mail nie jest jeszcze skonfigurowana.
//
// Kody wyjścia: 0 OK, 1 błąd, 2 błędne argumenty, 20 instancja ma już Posła, 21 adres zajęty.
// Komenda odmawia, gdy istnieje jakikolwiek profil Posła - nie da się nią przejąć instancji.

import { parseArgs } from 'node:util';
import { getServiceClient } from '../api/_lib/supabase.js';
import { DbError, errorSummary } from '../api/_lib/log-safe.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class CliError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function parse(argv: string[]): { email: string; name: string; delivery: 'email' | 'link' } {
  let values: { email?: string; name?: string; delivery?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { email: { type: 'string' }, name: { type: 'string' }, delivery: { type: 'string' } },
      strict: true,
    }));
  } catch (err) {
    throw new CliError(2, err instanceof Error ? err.message : 'Błędne argumenty');
  }
  const email = values.email?.trim().toLowerCase() ?? '';
  const name = values.name?.trim() ?? '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw new CliError(2, 'Podaj poprawny --email');
  if (name.length < 2 || name.length > 200) throw new CliError(2, 'Podaj --name (2-200 znaków)');
  if (values.delivery !== 'email' && values.delivery !== 'link') throw new CliError(2, 'Podaj --delivery email albo --delivery link');
  return { email, name, delivery: values.delivery };
}

async function run(argv: string[]): Promise<void> {
  const { email, name, delivery } = parse(argv);
  const redirectTo = process.env.AUTH_REDIRECT_URL?.trim();
  if (!redirectTo) throw new CliError(1, 'Brak AUTH_REDIRECT_URL w env kontenera');
  const db = getServiceClient();

  const { count, error: countError } = await db
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'posel');
  if (countError) throw new CliError(1, new DbError(countError, 'profiles').message);
  if ((count ?? 0) > 0) throw new CliError(20, 'Instancja ma już Posła - kolejne konta zakłada Poseł w panelu.');

  const { data: existing, error: existingError } = await db
    .from('profiles')
    .select('id')
    .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(1)
    .maybeSingle();
  if (existingError) throw new CliError(1, new DbError(existingError, 'profiles').message);
  if (existing) throw new CliError(21, 'Profil z tym adresem już istnieje');

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name: name },
  });
  if (createError || !created?.user) {
    const taken = createError?.status === 422 || /already|exists/i.test(createError?.message ?? '');
    const detail = createError ? new DbError(createError, 'createUser').message : 'createUser: brak użytkownika';
    throw new CliError(taken ? 21 : 1, taken ? 'Konto Auth z tym adresem już istnieje' : detail);
  }
  const userId = created.user.id;
  const rollback = async () => {
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) console.error('Wycofanie konta nieudane', errorSummary(error));
  };

  let link: string | null = null;
  if (delivery === 'email') {
    const { error } = await db.auth.admin.inviteUserByEmail(email, { data: { full_name: name }, redirectTo });
    if (error) {
      await rollback();
      throw new CliError(1, new DbError(error, 'Zaproszenie nieudane').message);
    }
  } else {
    const { data, error } = await db.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo, data: { full_name: name } } });
    if (error || !data?.properties?.action_link) {
      await rollback();
      throw new CliError(1, error ? new DbError(error, 'Link nieudany').message : 'Link nieudany: brak linku');
    }
    link = data.properties.action_link;
  }

  const { error: profileError } = await db
    .from('profiles')
    .insert({ id: userId, email, full_name: name, role: 'posel', is_active: true });
  if (profileError) {
    await rollback();
    throw new CliError(1, new DbError(profileError, 'Profil nieudany').message);
  }
  const { error: auditError } = await db.rpc('service_log_audit', {
    p_user_id: userId,
    p_action: 'user.create',
    p_entity_type: 'profile',
    p_entity_id: userId,
    p_metadata: { role: 'posel', via: 'first-posel' },
  });
  if (auditError) console.error('Wpis audytu nieudany', errorSummary(auditError));

  console.error(`Konto Posła utworzone (id ${userId}).`);
  if (link) {
    // Jedyny wynik na stdout: jednorazowy link do przekazania Posłowi (nie zapisuj go w logach).
    process.stdout.write(`${link}\n`);
  } else {
    console.error('Zaproszenie wysłane na podany adres.');
  }
}

run(process.argv.slice(2)).then(
  () => process.exit(0),
  (err: unknown) => {
    // Komunikaty CliError nie niosą treści błędów bazy/Auth (tylko kody) - reszta jako podsumowanie.
    console.error(err instanceof CliError ? err.message : errorSummary(err));
    process.exit(err instanceof CliError ? err.code : 1);
  },
);
