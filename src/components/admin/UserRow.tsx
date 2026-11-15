import {
  Building2,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatDistanceToNow, isAfter, subHours } from 'date-fns';
import { pl } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HOVER_REVEAL, LIST_ROW, StatusPill, type PillTone } from '@/components/admin/AdminUi';

import { isAdmin } from '@/lib/permissions';
import { useMpForms, useRoleLabel } from '@/hooks/useMpForms';
import { poselOnlyHint } from '@/hooks/useUsers';
import { cn } from '@/lib/utils';
import type { AppRole, ProfileWithOffice } from '@/integrations/supabase/types';

const ROLE_TONE: Record<AppRole, PillTone> = {
  posel: 'primary',
  administrator: 'primary',
  pracownik: 'info',
  asystent: 'neutral',
};

const ICON_BTN = 'h-10 w-10 md:h-8 md:w-8';

function hasRestrictedScope(u: ProfileWithOffice): boolean {
  return (
    u.scope_contacts === 'own' || u.scope_cases === 'own' ||
    u.scope_events === 'own' || u.scope_interpellations === 'own'
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

function ActivityDot({ lastSignIn }: { lastSignIn: string | null }) {
  const active = lastSignIn ? isAfter(new Date(lastSignIn), subHours(new Date(), 24)) : false;
  const label = lastSignIn
    ? `Ostatnio aktywny: ${formatDistanceToNow(new Date(lastSignIn), { locale: pl, addSuffix: true })}`
    : 'Brak danych o logowaniu';
  return (
    <span
      title={label}
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card',
        active ? 'bg-emerald-500' : 'bg-muted-foreground/30',
      )}
    />
  );
}

function UserPills({ user, className }: { user: ProfileWithOffice; className?: string }) {
  const roleLabel = useRoleLabel();
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <StatusPill tone={ROLE_TONE[user.role]} dot={false}>{roleLabel(user.role)}</StatusPill>
      {!user.is_active ? (
        <StatusPill tone="neutral">Nieaktywne</StatusPill>
      ) : !user.password_set ? (
        <StatusPill tone="warning">Oczekuje</StatusPill>
      ) : (
        <StatusPill tone="success">Aktywne</StatusPill>
      )}
      {!isAdmin(user.role) && hasRestrictedScope(user) && (
        <StatusPill
          tone="warning"
          title="Ograniczony zakres dostępu"
          icon={<EyeOff className="h-3 w-3" />}
        >
          Zakres
        </StatusPill>
      )}
    </div>
  );
}

export interface UserRowHandlers {
  onEdit: (u: ProfileWithOffice) => void;
  onSendLink: (u: ProfileWithOffice) => void;
  onDetails: (u: ProfileWithOffice) => void;
  onChangeOffice: (u: ProfileWithOffice) => void;
  onChangeRole: (u: ProfileWithOffice, role: AppRole) => void;
  onToggleActive: (u: ProfileWithOffice) => void;
  onResetMfa: (u: ProfileWithOffice) => void;
  onRevokeSessions: (u: ProfileWithOffice) => void;
  onDelete: (u: ProfileWithOffice) => void;
}

interface Props extends UserRowHandlers {
  user: ProfileWithOffice;
  isMe: boolean;
  isLinkPending: boolean;
  /** Czy zalogowany może zmieniać konta Posłów (tylko rola 'posel'; Administrator nie). */
  canManagePosel: boolean;
}

/** Kompaktowy wiersz listy zespołu: avatar, dane, pigułki roli/statusu, akcje. */
export function UserRow({ user: u, isMe, isLinkPending, canManagePosel, ...h }: Props) {
  const mp = useMpForms();
  // Konto Posła: Administrator widzi tylko akcje, których serwer mu nie blokuje
  // (edycja profilu, szczegóły, biuro). Rolę 'posel' nadaje tylko Poseł.
  const poselLocked = u.role === 'posel' && !canManagePosel;
  const lockHint = poselOnlyHint(mp);
  return (
    <div className={cn(LIST_ROW, '@max-md:items-start @max-md:gap-2.5', !u.is_active && 'opacity-60')}>
      <div className="relative shrink-0">
        <Avatar className="h-9 w-9">
          {u.avatar_url && (
            <AvatarImage src={`${u.avatar_url}?v=${u.updated_at}`} alt={u.full_name} />
          )}
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {initials(u.full_name)}
          </AvatarFallback>
        </Avatar>
        <span className="absolute -bottom-0.5 -right-0.5">
          <ActivityDot lastSignIn={u.last_sign_in_at} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium leading-tight">
          <span className="truncate">{u.full_name}</span>
          {isMe && <span className="shrink-0 text-xs font-normal text-muted-foreground">(Ty)</span>}
        </p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="min-w-0 shrink truncate @md:shrink-0">{u.email}</span>
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{u.office ? `${u.office.name} — ${u.office.city}` : 'Brak biura'}</span>
          </span>
        </p>
        <UserPills user={u} className="mt-1.5 @md:hidden" />
      </div>

      <UserPills user={u} className="hidden shrink-0 justify-end @md:flex" />
      {isMe ? (
        // Zastępuje 3 przyciski 32 px (gap 2 px), żeby pigułki były w jednej kolumnie z innymi wierszami.
        <div className="hidden w-[100px] shrink-0 md:block" aria-hidden />
      ) : (
        <div className="flex shrink-0 items-center gap-0.5">
          <div className={cn('flex items-center gap-0.5 max-md:hidden', HOVER_REVEAL)}>
            <Button
              variant="ghost"
              size="icon"
              className={ICON_BTN}
              onClick={() => h.onEdit(u)}
              title="Edytuj profil"
              aria-label="Edytuj profil"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {/* Wyłączony przycisk nie łapie hovera - podpowiedź na opakowaniu. */}
            <span className="inline-flex" title={poselLocked ? lockHint : undefined}>
              <Button
                variant="ghost"
                size="icon"
                className={ICON_BTN}
                disabled={isLinkPending || poselLocked}
                onClick={() => h.onSendLink(u)}
                title={u.password_set ? 'Wyślij link resetu hasła' : 'Wyślij zaproszenie'}
                aria-label={poselLocked ? lockHint : (u.password_set ? 'Wyślij link resetu hasła' : 'Wyślij zaproszenie')}
              >
                {isLinkPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Mail className="h-3.5 w-3.5" />}
              </Button>
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={ICON_BTN} aria-label="Więcej akcji">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="md:hidden" onClick={() => h.onEdit(u)}>
                <Pencil className="h-4 w-4" />Edytuj profil
              </DropdownMenuItem>
              {!poselLocked && (
                <DropdownMenuItem className="md:hidden" disabled={isLinkPending} onClick={() => h.onSendLink(u)}>
                  <Mail className="h-4 w-4" />
                  {u.password_set ? 'Wyślij link resetu hasła' : 'Wyślij zaproszenie'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="md:hidden" />
              <DropdownMenuItem onClick={() => h.onDetails(u)}>Szczegóły konta</DropdownMenuItem>
              <DropdownMenuItem onClick={() => h.onChangeOffice(u)}>Zmień biuro</DropdownMenuItem>
              <DropdownMenuSeparator />
              {poselLocked ? (
                <DropdownMenuLabel className="flex items-start gap-2 text-xs font-normal text-muted-foreground">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {lockHint}
                </DropdownMenuLabel>
              ) : (
                <>
                  {canManagePosel && (
                    <DropdownMenuItem onClick={() => h.onChangeRole(u, 'posel')}>Rola: {mp.nominative}</DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => h.onChangeRole(u, 'administrator')}>Rola: Administrator</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => h.onChangeRole(u, 'pracownik')}>Rola: Pracownik</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => h.onChangeRole(u, 'asystent')}>Rola: Asystent</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => h.onToggleActive(u)}>
                    {u.is_active ? 'Deaktywuj konto' : 'Aktywuj konto'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => h.onResetMfa(u)}>
                    <KeyRound className="h-4 w-4" />Resetuj 2FA
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => h.onRevokeSessions(u)} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" />Wyloguj ze wszystkich urządzeń
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => h.onDelete(u)} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-4 w-4" />Usuń konto trwale
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
