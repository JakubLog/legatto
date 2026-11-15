import { Link, useSearchParams } from 'react-router-dom';
import { Activity, ChevronRight, ClipboardList } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SearchSelect } from '@/components/ui/search-select';
import { Page, PageHeader } from '@/components/layout/Page';
import { ErrorNotice, LIST_PANEL, ListSkeleton, StatusPill, type PillTone } from '@/components/admin/AdminUi';
import { PersonTrend } from '@/components/pulse/PersonTrend';
import { PulseGauge } from '@/components/pulse/PulseGauge';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { OwnerAvatars } from '@/components/common/ModuleOwners';
import { useModuleOwners } from '@/hooks/useModuleOwners';
import { useOfficePulse } from '@/hooks/useModulePulse';
import { errorMessage } from '@/lib/errors';
import { OWNED_MODULES, PULSE_LEVEL_LABELS } from '@/lib/moduleOwners';
import { cn } from '@/lib/utils';
import type { ModulePulse, PulseLevel } from '@/integrations/supabase/types';

const LEVEL_TONE: Record<PulseLevel, PillTone> = {
  ok: 'success',
  warning: 'warning',
  critical: 'danger',
};

const LEVEL_ORDER: Record<PulseLevel, number> = { critical: 0, warning: 1, ok: 2 };

/** Reguły sygnałów. */
const RULES: { label: string; text: string }[] = [
  {
    label: 'Spadek działań',
    text: 'Aktywność obszaru z ostatnich 14 dni porównana ze średnią z 8 wcześniejszych tygodni: poniżej 60% średniej = osłabienie, 25% i mniej = bardzo duży spadek.',
  },
  {
    label: 'Aktywność opiekunów',
    text: 'Dni z logowaniem albo użyciem MCP w ostatnich 14 dniach (liczy się najaktywniejszy opiekun): 3 i mniej = osłabienie, 1 i mniej = bardzo duży spadek. Brak opiekuna = osłabienie.',
  },
  { label: 'Kalendarz', text: 'Wydarzenia dodane ręcznie (bez importu ICS); brak wydarzeń na najbliższe 14 dni = osłabienie.' },
  {
    label: 'Widoczność w terenie',
    text: 'Spotkania i wyjazdy w powiatach; co najmniej 25% powiatów bez obecności dłużej niż próg alertu = osłabienie, 50% = duży spadek.',
  },
  {
    label: 'Interpelacje',
    text: 'Wgrane interpelacje; zaakceptowana niewysłana po terminie = osłabienie (ponad 3 dni = duży spadek); uwagi bez poprawek ponad 3 dni = osłabienie (ponad 7 dni = duży spadek).',
  },
  { label: 'Budżet biura', text: 'Wpisy wydatków; ostatni wpis ponad 30 dni temu = osłabienie, ponad 60 dni = duży spadek.' },
  { label: 'Newsletter', text: 'Wysyłka co tydzień (GetResponse): ostatnia ponad 7 dni temu = osłabienie, ponad 14 dni albo brak = duży spadek.' },
];

export default function PulsBiura() {
  const ownersQ = useModuleOwners();
  const pulseQ = useOfficePulse();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtr: osoby z Pulsu = opiekunowie obszarów (unikalni, alfabetycznie).
  const people = [
    ...new Map((ownersQ.data ?? []).flatMap((o) => (o.user ? [[o.user.id, o.user] as const] : []))).values(),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name, 'pl'));
  const person = people.find((p) => p.id === searchParams.get('osoba')) ?? null;

  const setPerson = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!id) next.delete('osoba');
    else next.set('osoba', id);
    setSearchParams(next, { replace: true });
  };

  const rows = OWNED_MODULES.map((m) => ({
    ...m,
    owners: (ownersQ.data ?? []).filter((o) => o.module === m.module),
    pulse: pulseQ.data?.find((p) => p.module === m.module),
  }))
    .filter((r) => !person || r.owners.some((o) => o.user_id === person.id))
    .sort((a, b) => (a.pulse ? LEVEL_ORDER[a.pulse.level] : 3) - (b.pulse ? LEVEL_ORDER[b.pulse.level] : 3));
  const loading = pulseQ.isLoading || ownersQ.isLoading;

  return (
    <Page>
      <PageHeader
        icon={Activity}
        title="Puls Biura"
        description="Stan obszarów biura na podstawie sygnałów aktywności osób odpowiedzialnych."
        actions={
          // Konfiguracja (Podział obowiązków) jest desktop-only — ukrywamy skrót na telefonie.
          <Button variant="outline" size="sm" asChild className="max-md:hidden">
            <Link to="/biuro/admin/obowiązki">
              <ClipboardList />
              Podział obowiązków
            </Link>
          </Button>
        }
        toolbar={
          <SearchSelect
            aria-label="Osoba"
            className="w-full @sm:w-64"
            value={person?.id ?? null}
            onChange={setPerson}
            noneLabel="Całe biuro"
            placeholder="Całe biuro"
            options={people.map((p) => ({
              value: p.id,
              label: p.full_name,
              icon: <CreatorAvatar name={p.full_name} avatarUrl={p.avatar_url} className="h-5 w-5 ring-0" />,
            }))}
          />
        }
      />

      {(!person || rows.length > 0 || loading) && (
        <PulseGauge
          levels={rows.flatMap((r) => (r.pulse ? [r.pulse.level] : []))}
          loading={loading}
          caption={person ? `Obszary: ${person.full_name}` : undefined}
        />
      )}

      {person && <PersonTrend userId={person.id} fullName={person.full_name} avatarUrl={person.avatar_url} />}

      {pulseQ.isError && <ErrorNotice title="Nie udało się policzyć sygnałów" message={errorMessage(pulseQ.error)} />}

      <div className={LIST_PANEL}>
        {loading && <ListSkeleton rows={OWNED_MODULES.length} avatar />}
        {!loading && person && rows.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {person.full_name} nie odpowiada obecnie za żaden obszar.
          </p>
        )}
        {!loading &&
          rows.map((r) => (
            <div key={r.module} className="flex flex-col gap-3 px-4 py-4 @sm:flex-row @sm:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    r.pulse?.level === 'critical'
                      ? 'bg-destructive/10 text-destructive'
                      : r.pulse?.level === 'warning'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-primary/10 text-primary',
                  )}
                >
                  <r.Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Link to={r.to} className="text-sm font-semibold hover:underline">
                      {r.label}
                    </Link>
                    <OwnerAvatars owners={r.owners} level={r.pulse?.level} sizeClassName="h-6 w-6" />
                  </div>
                  <PulseDetails
                    pulse={r.pulse}
                    grUnavailable={r.module === 'newsletter' && pulseQ.grUnavailable}
                  />
                </div>
              </div>
              {/* W wąskim układzie status schodzi pod treść - wyrównany do kolumny tekstu (ikona 36px + odstęp 12px). */}
              {r.pulse ? (
                <StatusPill tone={LEVEL_TONE[r.pulse.level]} className="self-start @max-sm:ml-12">
                  {r.pulse.level === 'ok' ? 'W normie' : PULSE_LEVEL_LABELS[r.pulse.level]}
                </StatusPill>
              ) : (
                <StatusPill tone="neutral" className="self-start @max-sm:ml-12">
                  Brak danych
                </StatusPill>
              )}
            </div>
          ))}
      </div>

      <details className="group rounded-xl border bg-card px-4 py-3 text-sm shadow-card">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          Jak liczymy sygnały
        </summary>
        <ul className="mt-3 space-y-1.5 text-muted-foreground">
          {RULES.map((rule) => (
            <li key={rule.label}>
              <span className="font-medium text-foreground">{rule.label}:</span> {rule.text}
            </li>
          ))}
        </ul>
      </details>
    </Page>
  );
}

function PulseDetails({ pulse, grUnavailable }: { pulse?: ModulePulse; grUnavailable: boolean }) {
  // Wiersze renderują się dopiero po załadowaniu, więc brak sygnału = brak danych z obszaru.
  if (!pulse) return <p className="text-xs text-muted-foreground">Sygnał pojawi się po zebraniu pierwszych danych.</p>;

  const activity =
    pulse.recent_count === null
      ? null
      : pulse.baseline_avg === null
        ? `Wysyłki w ostatnich 14 dniach: ${pulse.recent_count}`
        : `Ostatnie 14 dni: ${pulse.recent_count} · wcześniej średnio ${pulse.baseline_avg.toLocaleString('pl-PL')} na 14 dni`;

  return (
    <div className="space-y-1 text-xs">
      {pulse.reasons && pulse.reasons.length > 0 ? (
        <ul className="space-y-0.5">
          {pulse.reasons.map((reason) => (
            <li key={reason} className="flex gap-1.5 text-foreground">
              <span aria-hidden>•</span>
              {reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Brak sygnałów zaniedbań.</p>
      )}
      {activity && <p className="text-muted-foreground">{activity}</p>}
      {grUnavailable && (
        <p className="text-muted-foreground">Integracja GetResponse nieaktywna - liczone są tylko wysyłki z aplikacji.</p>
      )}
      {pulse.owner_activity && pulse.owner_activity.length > 0 && (
        <p className="text-muted-foreground">
          Logowanie lub MCP (14 dni):{' '}
          {pulse.owner_activity
            .map((o) => `${o.full_name} ${o.active_days} ${o.active_days === 1 ? 'dzień' : 'dni'}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}
