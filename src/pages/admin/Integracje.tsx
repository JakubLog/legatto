import { useState } from 'react';
import { ShieldAlert, Terminal } from 'lucide-react';

import { Page, PageHeader } from '@/components/layout/Page';
import { BackToIntegrations } from '@/components/admin/BackToIntegrations';
import { McpGettingStarted } from '@/components/admin/McpGettingStarted';
import { OAuthClientsSection } from '@/components/admin/OAuthClientsSection';
import { McpTokensSection } from '@/components/admin/McpTokensSection';
import { CreateMcpTokenDialog } from '@/components/admin/CreateMcpTokenDialog';
import { RevokeMcpTokenDialog } from '@/components/admin/RevokeMcpTokenDialog';
import { DeleteMcpTokenDialog } from '@/components/admin/DeleteMcpTokenDialog';
import { useMcpTokens } from '@/hooks/useMcpTokens';
import { useAuth } from '@/contexts/AuthContext';
import { useMpForms } from '@/hooks/useMpForms';
import { isAdmin } from '@/lib/permissions';
import { getMcpUrl } from '@/lib/instanceUrls';
import type { McpToken } from '@/integrations/supabase/types';

export default function AdminIntegracje() {
  const { data: tokens, isLoading, error } = useMcpTokens();
  const { profile } = useAuth();
  const isPosel = isAdmin(profile?.role);
  const mp = useMpForms();
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenToRevoke, setTokenToRevoke] = useState<McpToken | null>(null);
  const [tokenToDelete, setTokenToDelete] = useState<McpToken | null>(null);

  const activeCount = (tokens ?? []).filter((t) => !t.revoked_at).length;

  return (
    <Page className="max-w-5xl">
      <BackToIntegrations />
      <PageHeader
        icon={Terminal}
        title="Połączenie MCP"
        description={
          <>
            Podłącz biuro do <strong>Claude</strong> przez MCP (Model Context Protocol). Z poziomu
            rozmowy zarządzaj sprawami wyborców, kontaktami, kalendarzem i interpelacjami.
          </>
        }
      />

      <McpGettingStarted mcpUrl={getMcpUrl()} />

      <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] text-amber-900 dark:text-amber-200">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
          <ShieldAlert className="h-[18px] w-[18px]" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Bezpieczeństwo</p>
          <p>
            {isPosel ? (
              <>
                Token i aplikacja OAuth dają Claude pełen dostęp do danych biura (sprawy, kontakty,
                kalendarz, interpelacje, budżet) z Twoimi uprawnieniami {mp.genitive}.
              </>
            ) : (
              <>
                Token i aplikacja OAuth dają Claude dostęp z Twoimi uprawnieniami Pracownika: sprawy,
                kontakty, kalendarz, wgrywanie interpelacji i odczyt budżetu — w Twoim zakresie danych.
              </>
            )}{' '}
            Wszystkie operacje są zapisywane do dziennika zmian z flagą{' '}
            <code className="rounded-md bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs">via_mcp=true</code>.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Plaintext tokena widoczny <strong>tylko raz</strong> przy generowaniu.</li>
            <li>W razie utraty — unieważnij token i wygeneruj nowy.</li>
            <li>Aktywnych tokenów: <strong>{activeCount}</strong> z {tokens?.length ?? 0}.</li>
          </ul>
        </div>
      </div>

      <OAuthClientsSection />

      <McpTokensSection
        tokens={tokens}
        isLoading={isLoading}
        error={error}
        onCreate={() => setCreateOpen(true)}
        onRevoke={setTokenToRevoke}
        onDelete={setTokenToDelete}
      />

      <CreateMcpTokenDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <RevokeMcpTokenDialog token={tokenToRevoke} onClose={() => setTokenToRevoke(null)} />
      <DeleteMcpTokenDialog token={tokenToDelete} onClose={() => setTokenToDelete(null)} />
    </Page>
  );
}
