import { getServiceClient } from '../supabase.js';
import { DbError } from '../log-safe.js';
import { logAudit } from '../audit.js';
import { isPoselRole } from '../auth.js';
import {
  type ToolDefinition,
  jsonResult,
  textResult,
  optionalBoolean,
  optionalEnum,
  optionalString,
  optionalUuid,
  requireString,
  POSEL_ONLY,
  POLIAI_ONLY,
  ToolValidationError,
} from './types.js';

const APP_ROLES = ['posel', 'administrator', 'pracownik', 'asystent'] as const;
const DATA_SCOPES = ['own', 'all'] as const;
const SCOPE_FIELDS = ['scope_cases', 'scope_contacts', 'scope_events', 'scope_interpellations'] as const;

// Katalog zespolu - to samo, co kazdy zalogowany widzi w aplikacji (profiles_select_authenticated).
const DIRECTORY_COLUMNS = 'id, full_name, email, phone, role, is_active, office:offices(id, name, city)';
// Widok admina (Posel/Administrator) - odpowiednik get_all_users_admin().
const ADMIN_COLUMNS = `${DIRECTORY_COLUMNS}, is_public, password_set, ${SCOPE_FIELDS.join(', ')}, created_at, updated_at`;

export const usersTools: ToolDefinition[] = [
  {
    name: 'users_list',
    title: 'Członkowie zespołu',
    readOnly: true,
    description:
      'Lista członków zespołu biura (imię, email, telefon, rola, biuro). Poseł i Administrator widzą dodatkowo zakresy danych (scope_*), status hasła i ostatnie logowanie. Domyślnie tylko aktywne konta.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: APP_ROLES },
        office_id: { type: 'string', description: 'UUID biura (z offices_list)' },
        include_inactive: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const role = optionalEnum(args, 'role', APP_ROLES);
      const officeId = optionalUuid(args, 'office_id');
      const supabase = getServiceClient();

      let q = supabase
        .from('profiles')
        .select(isPoselRole(ctx.userRole) ? ADMIN_COLUMNS : DIRECTORY_COLUMNS)
        .order('full_name');
      if (args.include_inactive !== true) q = q.eq('is_active', true);
      if (role) q = q.eq('role', role);
      if (officeId) q = q.eq('office_id', officeId);
      const { data, error } = await q;
      if (error) throw new DbError(error);
      const users = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;

      if (!isPoselRole(ctx.userRole)) return jsonResult({ count: users.length, users });

      // last_sign_in_at zyje w auth.users - zespol biura miesci sie w jednej stronie.
      const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (authError) throw new DbError(authError);
      const lastSignIn = new Map(authData.users.map((u) => [u.id, u.last_sign_in_at ?? null]));
      return jsonResult({
        count: users.length,
        users: users.map((u) => ({ ...u, last_sign_in_at: lastSignIn.get(u.id) ?? null })),
      });
    },
  },

  {
    name: 'users_get',
    title: 'Dane członka zespołu',
    readOnly: true,
    description:
      'Dane jednego członka zespołu. Poseł dostaje też szczegóły konta: zakresy danych, ostatnie logowanie, potwierdzenie emaila i liczbę skonfigurowanych czynników MFA.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'UUID użytkownika' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { data: profile, error } = await supabase
        .from('profiles')
        .select(isPoselRole(ctx.userRole) ? ADMIN_COLUMNS : DIRECTORY_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new DbError(error);
      if (!profile) return textResult(`Użytkownik o id=${id} nie istnieje.`, true);
      if (!isPoselRole(ctx.userRole)) return jsonResult({ user: profile });

      const [authRes, factorsRes] = await Promise.all([
        supabase.auth.admin.getUserById(id),
        supabase.auth.admin.mfa.listFactors({ userId: id }),
      ]);
      if (authRes.error) throw new DbError(authRes.error);
      if (factorsRes.error) throw new DbError(factorsRes.error);
      const factors = factorsRes.data.factors;
      return jsonResult({
        user: profile,
        account: {
          last_sign_in_at: authRes.data.user.last_sign_in_at ?? null,
          email_confirmed_at: authRes.data.user.email_confirmed_at ?? null,
          auth_created_at: authRes.data.user.created_at,
          mfa_factors_total: factors.length,
          mfa_factors_verified: factors.filter((f) => f.status === 'verified').length,
        },
      });
    },
  },

  {
    name: 'users_update',
    title: 'Zmiana konta członka zespołu',
    // Rola, is_active i zakresy danych - tylko PoliAI (zatwierdzenie w panelu), nie zewnetrzny MCP.
    channels: POLIAI_ONLY,
    description:
      'Zmienia profil członka zespołu: imię, telefon, rolę, biuro, aktywność konta, widoczność publiczną i zakresy danych (scope_* = own|all, tylko dla ról innych niż Poseł). Tylko Poseł. ' +
      'Pracownik i Asystent muszą mieć przypisane aktywne biuro. Nie możesz zmienić własnej roli ani dezaktywować własnego konta.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID użytkownika' },
        full_name: { type: 'string', minLength: 2, maxLength: 200 },
        phone: { type: 'string', maxLength: 50, description: 'Pusty string czyści telefon' },
        role: { type: 'string', enum: APP_ROLES },
        office_id: { type: ['string', 'null'], description: 'UUID biura; null odpina biuro (tylko Poseł może być bez biura)' },
        is_active: { type: 'boolean' },
        is_public: { type: 'boolean', description: 'Widoczność na publicznej stronie biura' },
        scope_cases: { type: 'string', enum: DATA_SCOPES },
        scope_contacts: { type: 'string', enum: DATA_SCOPES },
        scope_events: { type: 'string', enum: DATA_SCOPES },
        scope_interpellations: { type: 'string', enum: DATA_SCOPES },
      },
      required: ['id'],
      additionalProperties: false,
    },
    roles: POSEL_ONLY,
    idempotent: true,
    handler: async (args, ctx) => {
      const id = requireString({ id: args.id }, 'id', 64);
      const supabase = getServiceClient();
      const { data: current, error: currentError } = await supabase
        .from('profiles')
        .select('id, role, office_id, is_active')
        .eq('id', id)
        .maybeSingle();
      if (currentError) throw new DbError(currentError);
      if (!current) return textResult(`Użytkownik o id=${id} nie istnieje.`, true);

      const update: Record<string, unknown> = {};
      if (args.full_name !== undefined) {
        const fullName = requireString(args, 'full_name', 200).trim();
        if (fullName.length < 2) throw new ToolValidationError('Pole "full_name" musi mieć min. 2 znaki.');
        update.full_name = fullName;
      }
      if (args.phone !== undefined) update.phone = optionalString(args, 'phone', 50);
      if (args.role !== undefined) update.role = optionalEnum(args, 'role', APP_ROLES);
      if (args.office_id !== undefined) update.office_id = optionalUuid(args, 'office_id');
      const isActive = optionalBoolean(args, 'is_active');
      if (isActive !== null) update.is_active = isActive;
      const isPublic = optionalBoolean(args, 'is_public');
      if (isPublic !== null) update.is_public = isPublic;
      for (const field of SCOPE_FIELDS) {
        if (args[field] !== undefined) update[field] = optionalEnum(args, field, DATA_SCOPES);
      }
      if (Object.keys(update).length === 0) return textResult('Brak pól do zaktualizowania.', true);

      if (id === ctx.userId) {
        if (update.role !== undefined && update.role !== current.role) {
          throw new ToolValidationError('Nie możesz zmienić własnej roli.');
        }
        if (update.is_active === false) {
          throw new ToolValidationError('Nie możesz dezaktywować własnego konta.');
        }
      }

      const finalRole = (update.role ?? current.role) as (typeof APP_ROLES)[number];
      const finalOfficeId = (args.office_id !== undefined ? update.office_id : current.office_id) as string | null;
      if (!isPoselRole(finalRole) && !finalOfficeId) {
        throw new ToolValidationError('Pracownik i Asystent muszą mieć przypisane biuro (office_id).');
      }
      if (isPoselRole(finalRole) && SCOPE_FIELDS.some((f) => update[f] !== undefined)) {
        throw new ToolValidationError('Poseł i Administrator zawsze widzą wszystkie dane - zakresy scope_* dotyczą tylko innych ról.');
      }
      if (update.office_id) {
        const { data: office, error: officeError } = await supabase
          .from('offices')
          .select('id, is_active')
          .eq('id', update.office_id as string)
          .maybeSingle();
        if (officeError) throw new DbError(officeError);
        if (!office) throw new ToolValidationError(`Biuro o id=${String(update.office_id)} nie istnieje.`);
        if (!office.is_active) throw new ToolValidationError('Nie można przypisać nieaktywnego biura.');
      }

      const { data, error } = await supabase
        .from('profiles')
        .update(update)
        .eq('id', id)
        .select(ADMIN_COLUMNS)
        .single();
      if (error) {
        // Strażnik profiles (trigger): 42501 = własna rola/aktywność, 23514 = ostatni aktywny Poseł.
        // service_role nie ma auth.uid(), więc 42501 łapie tu walidacja wyżej; 23514 działa zawsze.
        if (error.code === '42501' || error.code === '23514') throw new ToolValidationError(error.message);
        throw new DbError(error);
      }
      await logAudit(ctx, 'mcp.user_update', {
        entityType: 'profile',
        entityId: id,
        metadata: {
          fields: Object.keys(update),
          ...(update.role !== undefined ? { role_from: current.role, role_to: update.role } : {}),
          ...(update.is_active !== undefined ? { is_active: update.is_active } : {}),
          tool: 'users_update',
        },
      });
      return jsonResult({ updated: true, user: data });
    },
  },
];
