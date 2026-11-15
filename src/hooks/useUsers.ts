import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AppRole, DataScope, ProfileWithOffice } from '@/integrations/supabase/types';
import { functionErrorMessage } from '@/lib/errors';
import type { MpForms } from '@/lib/mpForms';

// Konto Posła (rola 'posel') tworzy, nadaje/odbiera rolę 'posel', (de)aktywuje, usuwa,
// resetuje mu 2FA, wylogowuje i wysyła link tylko Poseł - Administrator dostaje 403
// (Edge Functions, _shared/auth.ts isCallerPoselRole) albo 42501 (trigger
// profiles_guard_role_active). Nikt nie zmienia własnej roli ani aktywności.
// UI ukrywa te akcje Administratorowi; komunikat serwera i tak trafia do toastu.
export const canManagePoselAccounts = (actorRole?: AppRole | null): boolean => actorRole === 'posel';

/** Podpowiedź przy zablokowanych akcjach na koncie Posła (forma wg płci instancji). */
export function poselOnlyHint(mp: MpForms): string {
  return `Tylko ${mp.nominative} zarządza kontem ${mp.genitive} (nie Administrator).`;
}

// Pelny profil z emailem — używany TYLKO w admin/Users.tsx (Posel-only).
// RLS profiles_select_self pozwala useram SELECT tylko własnego profilu, więc
// dla widoku admina używamy SECURITY DEFINER RPC `get_all_users_admin()`, który
// wewnątrz sprawdza is_posel i dla nie-Posła rzuca błąd 42501.
interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  office_id: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_public: boolean;
  password_set: boolean;
  scope_contacts: DataScope;
  scope_cases: DataScope;
  scope_events: DataScope;
  scope_interpellations: DataScope;
  created_at: string;
  updated_at: string;
  office_name: string | null;
  office_city: string | null;
  last_sign_in_at: string | null;
}

export function useUsers() {
  return useQuery<ProfileWithOffice[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_all_users_admin');
      if (error) {
        console.error('[useUsers] get_all_users_admin error', error);
        throw error;
      }
      console.info('[useUsers] received rows:', (data ?? []).length);
      return ((data ?? []) as AdminUserRow[]).map((r) => ({
        id: r.id,
        email: r.email,
        full_name: r.full_name,
        role: r.role,
        is_active: r.is_active,
        office_id: r.office_id,
        phone: r.phone,
        avatar_url: r.avatar_url,
        is_public: r.is_public,
        password_set: r.password_set,
        scope_contacts: r.scope_contacts,
        scope_cases: r.scope_cases,
        scope_events: r.scope_events,
        scope_interpellations: r.scope_interpellations,
        created_at: r.created_at,
        updated_at: r.updated_at,
        office:
          r.office_id && r.office_name
            ? { id: r.office_id, name: r.office_name, city: r.office_city ?? '' }
            : null,
        last_sign_in_at: r.last_sign_in_at ?? null,
      }));
    },
    staleTime: 60_000,
  });
}

// Minimalny zestaw (id, full_name, role) widoczny dla wszystkich aktywnych userów
// przez SECURITY DEFINER `get_assignable_users()` — używany w dropdownach
// przypisań (CaseFormDialog, EventFormDialog, filtry list). Nie zwraca emaila.
export interface AssignableUser {
  id: string;
  full_name: string;
  role: AppRole;
  avatar_url: string | null;
  office_id: string | null;
  office_name: string | null;
  office_city: string | null;
}

export function useAssignableUsers() {
  return useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_assignable_users');
      if (error) throw error;
      return (data ?? []) as AssignableUser[];
    },
    staleTime: 5 * 60_000,
  });
}

interface CreateUserInput {
  email: string;
  full_name: string;
  role: AppRole;
  office_id?: string | null;
  scope_contacts?: DataScope;
  scope_cases?: DataScope;
  scope_events?: DataScope;
  scope_interpellations?: DataScope;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const { data, error } = await supabase.functions.invoke<{ success: boolean; user_id: string }>(
        'admin-create-user',
        { body: input },
      );
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error('Nie udało się utworzyć użytkownika');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

interface UpdateUserInput {
  id: string;
  full_name?: string;
  role?: AppRole;
  is_active?: boolean;
  office_id?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  is_public?: boolean;
  scope_contacts?: DataScope;
  scope_cases?: DataScope;
  scope_events?: DataScope;
  scope_interpellations?: DataScope;
}

// Triggery profili zgłaszają po polsku: 42501 "Nie można zmienić własnej roli ani aktywności",
// 42501 "Tylko Poseł może nadać, odebrać, aktywować lub dezaktywować konto Posła",
// 23514 "Nie można usunąć ani zdezaktywować ostatniego aktywnego Posła" - pokazujemy je wprost.
// Sam RLS / constraint daje angielski tekst Postgresa, więc ten zamieniamy na polski.
function profileUpdateErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === '42501' && /row-level security/i.test(error.message)) {
    return 'Brak uprawnień do tej zmiany.';
  }
  if (error.code === '23514' && /avatar_url/i.test(error.message)) {
    return 'Nieprawidłowy adres zdjęcia profilowego - wgraj zdjęcie ponownie.';
  }
  if (error.code === '23514' && /violates check constraint/i.test(error.message)) {
    return 'Zmiana narusza reguły kont (sprawdź rolę i przypisane biuro).';
  }
  return error.message;
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateUserInput) => {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id);
      if (error) throw new Error(profileUpdateErrorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['public-office-staff'] });
    },
  });
}

// Wysylka linku autoryzacyjnego — Edge Function admin-send-auth-link.
// Tryb wybierany dynamicznie po stronie BE na podstawie profile.password_set:
//  - false -> 'invite' (re-send zaproszenia)
//  - true  -> 'recovery' (link resetu hasla)
// Cooldown 5 min/user (BE sprawdza audit_log, zwraca 429 z retry_after_seconds).
export interface SendAuthLinkResult {
  kind: 'invite' | 'recovery';
}

export function useSendAuthLink() {
  return useMutation<SendAuthLinkResult, Error, string>({
    mutationFn: async (userId) => {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        kind: 'invite' | 'recovery';
      }>('admin-send-auth-link', {
        body: { user_id: userId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error('Nie udało się wysłać linku');
      return { kind: data.kind };
    },
  });
}

// Wymuszenie wylogowania ze wszystkich urzadzen + reset MFA.
// Edge Function admin-revoke-user-sessions: signOut(global) + delete wszystkich MFA factor-ow,
// losowe haslo (password_set=false), odwolanie tokenow MCP / klientow OAuth i mail z linkiem
// do ustawienia nowego hasla (tylko aktywne konto). Audit po stronie BE.
export interface RevokeSessionsResult {
  mfa_deleted_count: number;
  recovery_sent: boolean;
}

export function useRevokeUserSessions() {
  const qc = useQueryClient();
  return useMutation<RevokeSessionsResult, Error, string>({
    mutationFn: async (userId) => {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        mfa_deleted_count: number;
        recovery_sent?: boolean;
      }>('admin-revoke-user-sessions', {
        body: { user_id: userId },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error('Nie udało się wylogować użytkownika');
      return { mfa_deleted_count: data.mfa_deleted_count, recovery_sent: data.recovery_sent === true };
    },
    onSuccess: (_data, userId) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user-admin-details', userId] });
      qc.invalidateQueries({ queryKey: ['mfa-factors'] });
    },
  });
}

// Szczegoly konta auth dla panelu administracyjnego (last_sign_in, MFA counts itd.).
// Wymaga RPC get_user_admin_details (Posel-only, sprawdzane w SECURITY DEFINER).
export interface UserAdminDetails {
  user_id: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  auth_created_at: string;
  sessions_count: number;
  mfa_factors_total: number;
  mfa_factors_verified: number;
}

export function useUserAdminDetails(userId: string | null | undefined) {
  return useQuery<UserAdminDetails | null>({
    queryKey: ['user-admin-details', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase.rpc('get_user_admin_details', {
        p_user_id: userId,
      });
      if (error) throw error;
      const rows = (data ?? []) as UserAdminDetails[];
      return rows[0] ?? null;
    },
    staleTime: 30_000,
  });
}

// Calkowite usuniecie konta — Edge Function admin-delete-user.
// Usuwa auth.users (CASCADE na profiles); FK w innych tabelach maja ON DELETE SET NULL,
// wiec historia (sprawy/wydarzenia/audit) zostaje zachowana z autorem = NULL.
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke<{ success: boolean }>(
        'admin-delete-user',
        { body: { user_id: userId } },
      );
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.success) throw new Error('Nie udało się usunąć użytkownika');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['assignable-users'] });
      qc.invalidateQueries({ queryKey: ['public-office-staff'] });
    },
  });
}

// Self-edit: każdy aktywny user może edytowac własny full_name/phone/avatar_url/is_public.
// RLS policy `profiles_update_self` blokuje zmiane role i is_active.
interface UpdateMyProfileInput {
  full_name?: string;
  phone?: string | null;
  avatar_url?: string | null;
  is_public?: boolean;
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateMyProfileInput & { id: string }) => {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id);
      if (error) throw new Error(profileUpdateErrorMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['public-office-staff'] });
    },
  });
}

// Upload zdjęcia profilowego do Storage bucketu `avatars`.
// Wymaga migracji 20260427200000_avatars_bucket.sql.
// Path: {userId}/{timestamp}.{ext} - nowy plik przy każdym upload (cache buster).
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function useUploadAvatar() {
  return useMutation({
    mutationFn: async ({ userId, file }: { userId: string; file: File }): Promise<string> => {
      if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
        throw new Error('Dozwolone formaty: JPG, PNG, WebP');
      }
      if (file.size > AVATAR_MAX_BYTES) {
        throw new Error('Plik za duzy (max 2 MB)');
      }
      const ext = file.name.includes('.')
        ? file.name.split('.').pop()!.toLowerCase()
        : file.type.split('/')[1] ?? 'jpg';
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      return data.publicUrl;
    },
  });
}
