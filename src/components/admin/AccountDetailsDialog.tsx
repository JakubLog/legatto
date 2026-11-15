import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import {
  CheckCircle2,
  Clock,
  KeyRound,
  Mail,
  ShieldCheck,
  Smartphone,
  UserRound,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice, StatusPill } from '@/components/admin/AdminUi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useUserAdminDetails } from '@/hooks/useUsers';
import type { ProfileWithOffice } from '@/integrations/supabase/types';

interface Props {
  user: ProfileWithOffice | null;
  onClose: () => void;
}

function fmt(value: string | null | undefined) {
  if (!value) return null;
  return format(new Date(value), 'd MMM yyyy, HH:mm', { locale: pl });
}

export function AccountDetailsDialog({ user, onClose }: Props) {
  const { data: details, isLoading, error } = useUserAdminDetails(user?.id ?? null);

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      {user && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              Szczegóły konta
            </DialogTitle>
            <DialogDescription>
              <span className="break-all">{user.full_name} ({user.email})</span>
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <div className="divide-y rounded-lg border" aria-busy="true" aria-label="Wczytywanie...">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <ErrorNotice
              title="Nie udało się pobrać szczegółów"
              message={error instanceof Error ? error.message : 'błąd'}
            />
          )}

          {details && (
            <dl className="divide-y rounded-lg border text-sm">
              <Row
                icon={<Mail className="h-4 w-4 text-muted-foreground" />}
                label="Email potwierdzony"
              >
                {details.email_confirmed_at ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {fmt(details.email_confirmed_at)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <XCircle className="h-4 w-4" />
                    Niepotwierdzony
                  </span>
                )}
              </Row>

              <Row
                icon={<Clock className="h-4 w-4 text-muted-foreground" />}
                label="Ostatnie logowanie"
              >
                {details.last_sign_in_at ? (
                  <span>{fmt(details.last_sign_in_at)}</span>
                ) : (
                  <span className="text-muted-foreground">Nigdy się nie zalogował</span>
                )}
              </Row>

              <Row
                icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
                label="Aktywne sesje"
              >
                <StatusPill tone={details.sessions_count > 0 ? 'primary' : 'neutral'} dot={false}>
                  {details.sessions_count}
                </StatusPill>
              </Row>

              <Row
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                label="2FA (TOTP)"
              >
                {details.mfa_factors_verified > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Skonfigurowane ({details.mfa_factors_verified})
                  </span>
                ) : details.mfa_factors_total > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Rozpoczęte (nie zweryfikowane)
                  </span>
                ) : (
                  <span className="text-muted-foreground">Brak</span>
                )}
              </Row>

              <Row
                icon={<KeyRound className="h-4 w-4 text-muted-foreground" />}
                label="Hasło"
              >
                {user.password_set ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Ustawione
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    Czeka na pierwsze ustawienie
                  </span>
                )}
              </Row>

              <Row
                icon={<Clock className="h-4 w-4 text-muted-foreground" />}
                label="Konto utworzone"
              >
                <span>{fmt(details.auth_created_at)}</span>
              </Row>
            </dl>
          )}

          <DialogFooter className="max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            <Button variant="outline" className="max-md:w-full" onClick={onClose}>
              Zamknij
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2 max-md:min-h-11 max-md:flex-col max-md:items-start max-md:gap-1.5">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="text-right max-md:w-full max-md:text-left max-md:[overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
