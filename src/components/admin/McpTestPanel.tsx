import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Status = 'idle' | 'pending' | 'ok' | 'err';

interface RunState {
  status: Status;
  http?: number;
  body?: string;
  error?: string;
  warning?: string;
  startedAt?: number;
  finishedAt?: number;
}

const INITIAL: RunState = { status: 'idle' };

const SPA_FALLBACK_HINT =
  'Endpoint zwrócił HTML zamiast JSON-a — to zwykle SPA fallback (Vite dev server, ' +
  'lub Vercel preview bez zdeployowanej funkcji). Wskaż URL produkcyjny lub odpal `vercel dev`.';

interface ValidatedResponse {
  status: Status;
  body: string;
  warning?: string;
}

function validateResponse(res: Response, text: string): ValidatedResponse {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    const trimmed = text.trim();
    const previewLen = Math.min(trimmed.length, 400);
    const isHtml = trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype');
    return {
      status: 'err',
      body: trimmed.slice(0, previewLen) + (trimmed.length > previewLen ? '\n\n[... obcięto ...]' : ''),
      warning: isHtml ? SPA_FALLBACK_HINT : `Niespodziewany Content-Type: "${contentType || 'brak'}".`,
    };
  }

  let pretty = text;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    return { status: 'err', body: text, warning: 'Odpowiedź ma Content-Type JSON ale nie da się sparsować.' };
  }

  return {
    status: res.ok ? 'ok' : 'err',
    body: pretty,
  };
}

function defaultUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/api/mcp`;
}

export function McpTestPanel() {
  const [url, setUrl] = useState<string>(defaultUrl());
  const [token, setToken] = useState<string>('');
  const [run, setRun] = useState<RunState>(INITIAL);
  const [activeTest, setActiveTest] = useState<string | null>(null);

  const elapsed = useMemo(() => {
    if (!run.startedAt || !run.finishedAt) return null;
    return run.finishedAt - run.startedAt;
  }, [run.startedAt, run.finishedAt]);

  const callJsonRpc = async (label: string, payload: Record<string, unknown>) => {
    setActiveTest(label);
    const startedAt = Date.now();
    setRun({ status: 'pending', startedAt });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const validated = validateResponse(res, text);
      setRun({
        status: validated.status,
        http: res.status,
        body: validated.body,
        warning: validated.warning,
        startedAt,
        finishedAt: Date.now(),
      });
    } catch (err) {
      setRun({
        status: 'err',
        error: err instanceof Error ? err.message : String(err),
        startedAt,
        finishedAt: Date.now(),
      });
    }
  };

  const callGet = async () => {
    setActiveTest('GET (diagnostyka)');
    const startedAt = Date.now();
    setRun({ status: 'pending', startedAt });
    try {
      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      const validated = validateResponse(res, text);

      // Dodatkowa weryfikacja: GET na nasz endpoint zwraca serverInfo.name = "office-mcp".
      // Jesli odpowiedz to JSON ale nie zawiera tego markera - to nie jest nasz serwer.
      let warning = validated.warning;
      let status = validated.status;
      if (status === 'ok' && !validated.body.includes('office-mcp')) {
        warning =
          'Endpoint zwrócił poprawny JSON, ale brakuje markera "office-mcp" w serverInfo - to chyba inny serwer.';
        status = 'err';
      }

      setRun({
        status,
        http: res.status,
        body: validated.body,
        warning,
        startedAt,
        finishedAt: Date.now(),
      });
    } catch (err) {
      setRun({
        status: 'err',
        error: err instanceof Error ? err.message : String(err),
        startedAt,
        finishedAt: Date.now(),
      });
    }
  };

  const tokenValid = token.startsWith('epm_') && token.length > 20;
  const busy = run.status === 'pending';
  const isLocalhost = useMemo(() => {
    try {
      const u = new URL(url);
      return ['localhost', '127.0.0.1', '0.0.0.0'].includes(u.hostname);
    } catch {
      return false;
    }
  }, [url]);

  const StatusBadge = () => {
    if (run.status === 'pending') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (run.status === 'ok')
      return (
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {run.http} OK
        </span>
      );
    if (run.status === 'err')
      return (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircle className="h-4 w-4" />
          {run.http ? `HTTP ${run.http}` : 'błąd sieci'}
        </span>
      );
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-5 w-5 text-fuchsia-600" />
          Test połączenia
        </CardTitle>
        <CardDescription>
          Wklej token i sprawdź czy serwer MCP odpowiada. Działa też na localhost - jeśli endpoint
          nie żyje lokalnie (Vite dev server bez Vercel), wskaż URL produkcyjny.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLocalhost && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Localhost wykryty.</strong> Vite dev server (`pnpm dev`) nie obsługuje
              serverless funkcji - każde wywołanie `/api/mcp` trafia w SPA fallback (HTML).
              Żeby przetestować lokalnie: uruchom <code>pnpm dlx vercel dev</code>. Inaczej wpisz
              produkcyjny URL.
            </div>
          </div>
        )}

        <div className="grid gap-3 @sm:grid-cols-[1fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-test-url">Endpoint URL</Label>
            <Input
              id="mcp-test-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://twoja-domena.pl/api/mcp"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Domyślnie: bieżąca domena. Na localhost wpisz produkcyjny URL.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-test-token">Token</Label>
            <Input
              id="mcp-test-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="epm_..."
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Plaintext widziany przy generowaniu (sha256 w DB). GET nie wymaga tokena.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !url}
            onClick={() => void callGet()}
          >
            {busy && activeTest === 'get' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            GET (diagnostyka)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !url || !tokenValid}
            onClick={() =>
              void callJsonRpc('tools/list', { jsonrpc: '2.0', id: 1, method: 'tools/list' })
            }
          >
            {busy && activeTest === 'tools/list' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            tools/list
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !url || !tokenValid}
            onClick={() =>
              void callJsonRpc('cases.list', {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: { name: 'cases.list', arguments: { limit: 5 } },
              })
            }
          >
            {busy && activeTest === 'cases.list' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            cases.list (5)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !url || !tokenValid}
            onClick={() =>
              void callJsonRpc('events.list_upcoming', {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: { name: 'events.list_upcoming', arguments: { limit: 5 } },
              })
            }
          >
            {busy && activeTest === 'events.list_upcoming' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            events.list_upcoming (5)
          </Button>
        </div>

        {run.status !== 'idle' && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <StatusBadge />
                {activeTest && <span className="font-mono text-muted-foreground">{activeTest}</span>}
              </div>
              {elapsed !== null && <span className="text-muted-foreground">{elapsed} ms</span>}
            </div>
            {run.warning && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>{run.warning}</div>
              </div>
            )}
            {run.error && (
              <pre className="overflow-x-auto rounded bg-background px-2 py-1.5 text-xs text-destructive">
                {run.error}
              </pre>
            )}
            {run.body && (
              <pre className="max-h-96 overflow-auto rounded bg-background px-2 py-1.5 text-xs font-mono">
                {run.body}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
