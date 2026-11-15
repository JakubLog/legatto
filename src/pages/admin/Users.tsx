import { useState } from 'react';
import { Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Page, PageHeader } from '@/components/layout/Page';
import {
  canManagePoselAccounts,
  poselOnlyHint,
  useDeleteUser,
  useSendAuthLink,
  useUpdateUser,
  useUsers,
} from '@/hooks/useUsers';
import { useOffices } from '@/hooks/useOffices';
import { isAdmin } from '@/lib/permissions';
import { useMpForms, useRoleLabel } from '@/hooks/useMpForms';
import type { AppRole, ProfileWithOffice } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState, ErrorNotice, LIST_PANEL, ListSkeleton } from '@/components/admin/AdminUi';
import { UserRow } from '@/components/admin/UserRow';
import { plural } from '@/components/public/publicFormat';
import { CreateUserDialog } from '@/components/admin/CreateUserDialog';
import { ChangeOfficeDialog } from '@/components/admin/ChangeOfficeDialog';
import { DeleteUserDialog } from '@/components/admin/DeleteUserDialog';
import { EditUserProfileDialog } from '@/components/admin/EditUserProfileDialog';
import { ResetMfaDialog } from '@/components/admin/ResetMfaDialog';
import { RevokeSessionsDialog } from '@/components/admin/RevokeSessionsDialog';
import { AccountDetailsDialog } from '@/components/admin/AccountDetailsDialog';

export default function AdminUsers() {
  const { profile: me } = useAuth();
  const { data: users, isLoading, error: usersError } = useUsers();
  const { data: offices } = useOffices({ activeOnly: true });
  const updateUser   = useUpdateUser();
  const deleteUser   = useDeleteUser();
  const sendAuthLink = useSendAuthLink();
  const roleLabel    = useRoleLabel();
  const mp           = useMpForms();
  // Konta Posłów zmienia tylko Poseł (EDGE-6) - Administratorowi UI ukrywa te akcje.
  const canManagePosel = canManagePoselAccounts(me?.role);

  const [officeChange,        setOfficeChange]        = useState<ProfileWithOffice | null>(null);
  const [editProfileUser,     setEditProfileUser]     = useState<ProfileWithOffice | null>(null);
  const [deleteCandidate,     setDeleteCandidate]     = useState<ProfileWithOffice | null>(null);
  const [resetMfaUser,        setResetMfaUser]        = useState<ProfileWithOffice | null>(null);
  const [revokeSessionsUser,  setRevokeSessionsUser]  = useState<ProfileWithOffice | null>(null);
  const [accountDetailsUser,  setAccountDetailsUser]  = useState<ProfileWithOffice | null>(null);
  const [pendingLinkUserId,   setPendingLinkUserId]   = useState<string | null>(null);

  const handleRoleChange = async (user: ProfileWithOffice, newRole: AppRole) => {
    if (user.role === newRole) return;
    if (!canManagePosel && (user.role === 'posel' || newRole === 'posel')) {
      toast.error('Brak uprawnień', { description: poselOnlyHint(mp) });
      return;
    }
    if (!isAdmin(newRole) && !user.office_id) {
      toast.error('Brak biura', { description: 'Przypisz biuro przed zmianą roli.' });
      return;
    }
    try {
      await updateUser.mutateAsync({ id: user.id, role: newRole });
      toast.success(`Zmieniono rolę na ${roleLabel(newRole)}`);
    } catch (err) {
      toast.error('Błąd zmiany roli', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    }
  };

  const handleSendAuthLink = async (user: ProfileWithOffice) => {
    setPendingLinkUserId(user.id);
    try {
      const result = await sendAuthLink.mutateAsync(user.id);
      toast.success(result.kind === 'invite' ? 'Wysłano zaproszenie' : 'Wysłano link resetu hasła', {
        description: `Email do ${user.email}.`,
      });
    } catch (err) {
      toast.error(user.password_set ? 'Błąd wysyłki linku resetu' : 'Błąd wysyłki zaproszenia', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    } finally {
      setPendingLinkUserId(null);
    }
  };

  const handleToggleActive = async (user: ProfileWithOffice) => {
    try {
      await updateUser.mutateAsync({ id: user.id, is_active: !user.is_active });
      toast.success(user.is_active ? 'Konto deaktywowane' : 'Konto aktywowane', {
        description: user.is_active
          ? 'Sesje, tokeny MCP i aplikacje OAuth użytkownika zostały unieważnione.'
          : 'Użytkownik zaloguje się dotychczasowym hasłem. Dawne tokeny MCP pozostają odwołane.',
      });
    } catch (err) {
      toast.error('Błąd zmiany statusu', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
    }
  };

  return (
    <Page narrow>
      <PageHeader
        icon={UsersIcon}
        title="Zespół biura"
        description={isLoading ? 'Wczytywanie...' : `${users?.length ?? 0} ${plural(users?.length ?? 0, 'osoba', 'osoby', 'osób')}`}
        actions={<CreateUserDialog offices={offices} canManagePosel={canManagePosel} />}
      />

      {usersError && (
        <ErrorNotice
          title="Nie udało się pobrać listy użytkowników"
          message={usersError instanceof Error ? usersError.message : String(usersError)}
        />
      )}

      <div className={LIST_PANEL}>
        {isLoading && <ListSkeleton rows={4} avatar />}

        {!isLoading && (users ?? []).map((u) => (
          <UserRow
            key={u.id}
            user={u}
            isMe={me?.id === u.id}
            isLinkPending={pendingLinkUserId === u.id}
            canManagePosel={canManagePosel}
            onEdit={setEditProfileUser}
            onSendLink={handleSendAuthLink}
            onDetails={setAccountDetailsUser}
            onChangeOffice={setOfficeChange}
            onChangeRole={handleRoleChange}
            onToggleActive={handleToggleActive}
            onResetMfa={setResetMfaUser}
            onRevokeSessions={setRevokeSessionsUser}
            onDelete={setDeleteCandidate}
          />
        ))}
        {!isLoading && (users?.length ?? 0) === 0 && (
          <EmptyState icon={UsersIcon} title="Brak użytkowników." />
        )}
      </div>

      <EditUserProfileDialog user={editProfileUser} onClose={() => setEditProfileUser(null)} />
      <ResetMfaDialog user={resetMfaUser} onClose={() => setResetMfaUser(null)} />
      <RevokeSessionsDialog user={revokeSessionsUser} onClose={() => setRevokeSessionsUser(null)} />
      <AccountDetailsDialog user={accountDetailsUser} onClose={() => setAccountDetailsUser(null)} />

      <ChangeOfficeDialog
        key={officeChange?.id ?? 'none'}
        user={officeChange}
        offices={offices ?? []}
        onClose={() => setOfficeChange(null)}
        onSubmit={async (officeId) => {
          if (!officeChange) return;
          if (!isAdmin(officeChange.role) && !officeId) {
            toast.error('Pracownik i Asystent muszą mieć przypisane biuro');
            return;
          }
          try {
            await updateUser.mutateAsync({ id: officeChange.id, office_id: officeId });
            toast.success('Biuro zaktualizowane');
            setOfficeChange(null);
          } catch (err) {
            toast.error('Błąd zmiany biura', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
          }
        }}
      />

      <DeleteUserDialog
        key={deleteCandidate?.id ?? 'none-delete'}
        user={deleteCandidate}
        isPending={deleteUser.isPending}
        onClose={() => setDeleteCandidate(null)}
        onConfirm={async () => {
          if (!deleteCandidate) return;
          try {
            await deleteUser.mutateAsync(deleteCandidate.id);
            toast.success('Konto usunięte', { description: `${deleteCandidate.full_name} został trwale usunięty.` });
            setDeleteCandidate(null);
          } catch (err) {
            toast.error('Nie udało się usunąć konta', { description: err instanceof Error ? err.message : 'Nieznany błąd' });
          }
        }}
      />
    </Page>
  );
}
