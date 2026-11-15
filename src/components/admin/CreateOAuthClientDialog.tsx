import { useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Shield } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

import { useCreateOAuthClient, type OAuthClientCreated } from '@/hooks/useOAuthClients';
import { getMcpUrl } from '@/lib/instanceUrls';

interface Props { open: boolean; onClose: () => void; }

export function CreateOAuthClientDialog({ open, onClose }: Props) {
  const createMut = useCreateOAuthClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<OAuthClientCreated | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const mcpUrl = getMcpUrl();

  const reset = () => { setName(''); setCreated(null); setCopied(null); createMut.reset(); };
  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const result = await createMut.mutateAsync({ name: trimmed });
      setCreated(result);
    } catch (err) {
      toast.error('Nie udało się utworzyć OAuth App', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast.success('Skopiowano');
      setTimeout(() => setCopied(null), 2500);
    } catch { toast.error('Nie udało się skopiować'); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {created ? 'OAuth App utworzona' : 'Nowa OAuth App (claude.ai)'}
          </DialogTitle>
          <DialogDescription>
            {created
              ? 'Skopiuj Client ID i Client Secret — Secret widoczny tylko teraz.'
              : 'Generuje Client ID + Client Secret do wklejenia w claude.ai przy dodawaniu Remote MCP.'}
          </DialogDescription>
        </DialogHeader>

        {!created && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="oauth-app-name">Nazwa aplikacji</Label>
              <Input
                id="oauth-app-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude.ai — moje konto"
                maxLength={60}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !createMut.isPending) void handleCreate(); }}
              />
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Jak użyć:</p>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Wygeneruj tę OAuth App</li>
                <li>Na <strong>claude.ai → Settings → Integrations</strong> kliknij Add Integration</li>
                <li>Wpisz URL: <code className="bg-muted px-1 rounded">{mcpUrl}</code></li>
                <li>Wklej Client ID i Client Secret z poniższego okna</li>
                <li>Zaloguj się swoim kontem biura w oknie autoryzacji — Claude dostanie Twoje uprawnienia</li>
              </ol>
            </div>
          </div>
        )}

        {created && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <strong>Skopiuj teraz.</strong> Client Secret jest widoczny tylko raz — nie możemy go odtworzyć.
            </div>
            {[
              { label: 'Client ID', key: 'id', value: created.client_id },
              { label: 'Client Secret', key: 'secret', value: created.client_secret },
            ].map(({ label, key, value }) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <div className="flex gap-2">
                  <code className="flex-1 break-all rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs">
                    {value}
                  </code>
                  <Button size="icon" variant="outline" onClick={() => handleCopy(key, value)} title="Kopiuj">
                    {copied === key
                      ? <Check className="h-4 w-4 text-emerald-600" />
                      : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))}
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">MCP Server URL (do wpisania w claude.ai):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{mcpUrl}</code>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => handleCopy('url', mcpUrl)}>
                  {copied === 'url' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!created ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={createMut.isPending}>Anuluj</Button>
              <Button onClick={handleCreate} disabled={!name.trim() || createMut.isPending}>
                {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Utwórz OAuth App
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>
              <KeyRound className="h-4 w-4" />
              Gotowe
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
