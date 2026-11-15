import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, ChevronDown, Globe, Terminal } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  mcpUrl: string;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Path({
  icon: Icon,
  title,
  subtitle,
  intro,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium leading-tight">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">{intro}</p>
      <ol className="space-y-2 text-[13px]">{children}</ol>
    </div>
  );
}

const CODE = 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs';

/** Zwijana instrukcja podłączenia Claude (OAuth dla web, token dla terminala/desktop). */
export function McpGettingStarted({ mcpUrl }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:px-5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BookOpen className="h-[18px] w-[18px]" />
        </div>
        <span className="flex-1 text-sm font-semibold">Jak zacząć?</span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="grid gap-4 border-t p-4 sm:p-5 @md:grid-cols-2">
          <Path
            icon={Globe}
            title="Dla aplikacji Web / Desktop"
            subtitle="claude.ai, aplikacja Claude"
            intro={
              <>
                Łączysz się przez <strong>OAuth 2.0</strong> — nie wymaga ręcznego kopiowania
                tokena. Bezpieczniejsza opcja dla wielokrotnego użytku.
              </>
            }
          >
            <Step n={1}>W sekcji <strong>OAuth Apps</strong> poniżej kliknij „Nowa App" i nadaj jej nazwę.</Step>
            <Step n={2}>W Claude: <strong>Settings → Integrations → Add</strong> → wpisz URL serwera:</Step>
            <li className="ml-7">
              <code className={cn(CODE, 'break-all')}>{mcpUrl}</code>
            </li>
            <Step n={3}>Kliknij „Connect" — nastąpi przekierowanie do portalu biura z oknem zgody.</Step>
            <Step n={4}>
              Zatwierdź dostęp — połączenie aktywne. Claude działa z uprawnieniami Twojego konta
              (rola i zakres danych). Narzędzia pojawią się w oknie rozmowy.
            </Step>
          </Path>

          <Path
            icon={Terminal}
            title="Dla terminala / Claude Desktop"
            subtitle="konfiguracja JSON, inne klienty MCP"
            intro={
              <>
                Łączysz się przez <strong>token MCP</strong> — dłużej ważny klucz API wklejany
                ręcznie do pliku konfiguracyjnego.
              </>
            }
          >
            <Step n={1}>W sekcji <strong>Tokeny MCP</strong> poniżej kliknij „Wygeneruj token" i nadaj mu nazwę.</Step>
            <Step n={2}>Skopiuj token — widoczny <strong>tylko raz</strong> po wygenerowaniu.</Step>
            <Step n={3}>Otwórz plik konfiguracyjny Claude Desktop:</Step>
            <li className="ml-7 space-y-1 text-xs text-muted-foreground">
              <p>
                macOS:{' '}
                <code className={cn(CODE, 'break-all')}>
                  ~/Library/Application Support/Claude/claude_desktop_config.json
                </code>
              </p>
              <p>
                Windows:{' '}
                <code className={cn(CODE, 'break-all')}>%APPDATA%\Claude\claude_desktop_config.json</code>
              </p>
            </li>
            <Step n={4}>Wklej konfigurację JSON wyświetloną po generowaniu i zrestartuj Claude Desktop.</Step>
          </Path>
        </div>
      )}
    </Card>
  );
}
