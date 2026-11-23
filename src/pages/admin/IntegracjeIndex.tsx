import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Mail,
  Monitor,
  Plug,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/layout/Page';
import { EmptyState, StatusPill } from '@/components/admin/AdminUi';
import { AiStatusBadge } from '@/components/admin/AiSettingsCard';
import { useAuth } from '@/contexts/AuthContext';
import { useAiConnection } from '@/hooks/useAi';
import { useNotificationsAdminStatus } from '@/hooks/useNotifications';
import { useMcpTokens } from '@/hooks/useMcpTokens';
import { useGRStatus } from '@/hooks/useGetResponse';
import { useSecretSettingsStatus } from '@/hooks/useSecretSettings';
import { canWrite, isAdmin } from '@/lib/permissions';
import { INSTANCE } from '@/lib/instance';
import { cn } from '@/lib/utils';
import { plural } from '@/components/public/publicFormat';

/** Integracje dla każdej roli: MCP dla piszących (tylko z włączonym MCP), reszta tylko dla admina. */
export default function IntegracjeIndex() {
  const { profile } = useAuth();
  const role = profile?.role;
  const showMcp = INSTANCE.mcp && canWrite(role);
  const admin = isAdmin(role);
  const empty = !showMcp && !admin;
  // Kafelki konfiguracji tylko na komputer (trasy w DesktopOnlyRoute) - lista do informacji na telefonie.
  const desktopOnlyNames = [
    ...(showMcp ? ['Claude MCP'] : []),
    ...(admin && INSTANCE.getresponse ? ['GetResponse'] : []),
    ...(admin && INSTANCE.ics ? ['kalendarze ICS'] : []),
    ...(admin && INSTANCE.ai ? ['AI'] : []),
    ...(admin ? ['powiadomienia'] : []),
  ];

  return (
    <Page>
      <PageHeader
        icon={Plug}
        title="Integracje"
        description="Połączenia z zewnętrznymi usługami. Wybierz integrację, którą chcesz skonfigurować."
      />

      {empty ? (
        <Card>
          <EmptyState icon={Plug} title="Brak integracji dostępnych dla Twojego konta." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 @sm:grid-cols-2 @xl:grid-cols-3">
            {showMcp && <McpTile />}
            {admin && (
              <>
                {INSTANCE.getresponse && <GetResponseTile />}
                {INSTANCE.ics && <IcsTile />}
                {INSTANCE.ai && <AiTile />}
                <NotificationsTile />
              </>
            )}
          </div>
          {/* Kafelki konfiguracji tylko na komputer (trasy w DesktopOnlyRoute) są ukryte na telefonie. */}
          <p className="flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground md:hidden">
            <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Konfiguracja integracji ({desktopOnlyNames.join(', ')}) jest dostępna na komputerze.
          </p>
        </>
      )}
    </Page>
  );
}

interface IntegrationCardProps {
  to: string;
  icon: LucideIcon;
  iconClassName: string;
  name: string;
  tagline: string;
  description: ReactNode;
  status?: ReactNode;
  actionLabel?: string;
  /** Konfiguracja tylko na komputer: kafelek ukryty na telefonie. */
  desktopOnly?: boolean;
}

function IntegrationCard({
  to,
  icon: Icon,
  iconClassName,
  name,
  tagline,
  description,
  status,
  actionLabel = 'Konfiguruj',
  desktopOnly = false,
}: IntegrationCardProps) {
  return (
    <Card className={cn('flex h-full flex-col p-5 transition-shadow hover:shadow-card-hover', desktopOnly && 'max-md:hidden')}>
      <div className="flex items-start justify-between gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', iconClassName)}>
          <Icon className="h-5 w-5" />
        </div>
        {status}
      </div>
      <div className="mt-4 space-y-1">
        <h2 className="text-base font-semibold leading-tight">{name}</h2>
        <p className="text-xs font-medium text-muted-foreground">{tagline}</p>
      </div>
      <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-5">
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
          <Link to={to}>
            {actionLabel}
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function GetResponseTile() {
  const secretsQ = useSecretSettingsStatus();
  const hasKey = secretsQ.data?.getresponse_api_key.configured === true;
  const statusQ = useGRStatus(hasKey);

  let status: ReactNode;
  if (secretsQ.isLoading) {
    status = (
      <StatusPill tone="neutral" icon={<Loader2 className="h-3 w-3 animate-spin" />}>Ładowanie</StatusPill>
    );
  } else if (!hasKey) {
    status = <StatusPill tone="neutral">Nieskonfigurowane</StatusPill>;
  } else if (statusQ.isLoading) {
    status = (
      <StatusPill tone="warning" icon={<Loader2 className="h-3 w-3 animate-spin" />}>Sprawdzanie</StatusPill>
    );
  } else if (statusQ.data?.ok) {
    status = (
      <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Aktywne</StatusPill>
    );
  } else {
    status = (
      <StatusPill tone="danger" icon={<XCircle className="h-3 w-3" />}>Błąd połączenia</StatusPill>
    );
  }

  return (
    <IntegrationCard
      to="/biuro/admin/integracje/getresponse"
      icon={Mail}
      iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      name="GetResponse"
      tagline="Newsletter, kampanie e-mail"
      description={
        <>
          Klucz API, lista odbiorców i adres nadawcy. Wykorzystywane przez moduł „Kampanie
          e-mail” w zakładce Kontakty.
        </>
      }
      status={status}
      desktopOnly
    />
  );
}

function McpTile() {
  const { data: tokens } = useMcpTokens();
  const activeCount = (tokens ?? []).filter((t) => !t.revoked_at).length;

  const status =
    activeCount > 0 ? (
      <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
        {activeCount} {plural(activeCount, 'token', 'tokeny', 'tokenów')}
      </StatusPill>
    ) : (
      <StatusPill tone="neutral">Brak tokenów</StatusPill>
    );

  return (
    <IntegrationCard
      to="/biuro/admin/integracje/mcp"
      icon={Terminal}
      iconClassName="bg-primary/10 text-primary"
      name="Claude (MCP)"
      tagline="Połączenie z Claude"
      description={
        <>
          Tokeny MCP i aplikacje OAuth. Z poziomu Claude (web/desktop/terminal) zarządzasz sprawami,
          kontaktami, kalendarzem i interpelacjami.
        </>
      }
      status={status}
      actionLabel="Otwórz"
      desktopOnly
    />
  );
}

function IcsTile() {
  return (
    <IntegrationCard
      to="/biuro/admin/integracje/ics"
      icon={CalendarDays}
      iconClassName="bg-sky-500/10 text-sky-600 dark:text-sky-400"
      name="Kalendarze ICS"
      tagline="Google, Apple, Outlook"
      description="Import wydarzeń z zewnętrznych kalendarzy przez prywatny link ICS. Synchronizacja automatyczna raz dziennie, a w razie potrzeby także ręczna."
      desktopOnly
    />
  );
}

function AiTile() {
  const connectionQ = useAiConnection();

  return (
    <IntegrationCard
      to="/biuro/admin/integracje/ai"
      icon={Sparkles}
      iconClassName="bg-violet-500/10 text-violet-600 dark:text-violet-400"
      name="AI (Claude)"
      tagline="Bezpośrednie API Claude"
      description="Klucz API i model dla asystenta PoliAI oraz raportów AI w module Budżet."
      status={
        <AiStatusBadge isLoading={connectionQ.isLoading} connection={connectionQ.data} error={connectionQ.error} />
      }
      desktopOnly
    />
  );
}

function NotificationsTile() {
  const adminQ = useNotificationsAdminStatus();
  const data = adminQ.data;

  // E-mail i push liczą się tylko, gdy operator / admin biura włączył je na instancji (INSTANCE_EMAIL, INSTANCE_PUSH).
  const emailOn = INSTANCE.email && data?.settings.email_enabled === true;
  const pushOn = INSTANCE.push && data?.settings.push_enabled === true;
  const channels = [INSTANCE.email ? 'e-mail (Resend)' : null, INSTANCE.push ? 'push w aplikacji' : null].filter(Boolean);
  let status: ReactNode;
  if (adminQ.isLoading) {
    status = (
      <StatusPill tone="neutral" icon={<Loader2 className="h-3 w-3 animate-spin" />}>Ładowanie</StatusPill>
    );
  } else if (!data) {
    status = <StatusPill tone="neutral">Brak danych</StatusPill>;
  } else if (!emailOn && !pushOn) {
    status = <StatusPill tone="neutral">Wyłączone</StatusPill>;
  } else if (emailOn && !data.key.configured) {
    status = <StatusPill tone="warning">Brak klucza</StatusPill>;
  } else if (emailOn && !data.settings.from_email) {
    status = <StatusPill tone="warning">Brak nadawcy</StatusPill>;
  } else {
    // Także samo push przy świadomie wyłączonym e-mailu.
    status = (
      <StatusPill tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>Skonfigurowane</StatusPill>
    );
  }

  return (
    <IntegrationCard
      to="/biuro/admin/integracje/powiadomienia"
      icon={Bell}
      iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
      name="Powiadomienia"
      tagline={channels.length > 0 ? channels.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'W aplikacji'}
      description={`Powiadomienia o sprawach, wydarzeniach i bezpieczeństwie kont${channels.length > 0 ? `: ${channels.join(' i ')}` : ' w skrzynce aplikacji'}.`}
      status={status}
      desktopOnly
    />
  );
}
