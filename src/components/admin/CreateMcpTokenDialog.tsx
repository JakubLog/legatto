import { useState } from 'react';
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { MCP_TOKEN_LIFETIMES, useCreateMcpToken, type McpTokenLifetime } from '@/hooks/useMcpTokens';
import { McpConfigInstructions } from './McpConfigInstructions';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateMcpTokenDialog({ open, onClose }: Props) {
  const createMut = useCreateMcpToken();
  const [name, setName] = useState('');
  const [days, setDays] = useState<McpTokenLifetime>(90);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setName('');
    setDays(90);
    setToken(null);
    setCopied(false);
    createMut.reset();
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const value = await createMut.mutateAsync({ name: trimmed, days });
      setToken(value);
    } catch (err) {
      toast.error('Nie udało się wygenerować tokena', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success('Token skopiowany do schowka');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Nie udało się skopiować - skopiuj ręcznie');
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            {token ? 'Token wygenerowany' : 'Nowy token MCP'}
          </DialogTitle>
          <DialogDescription>
            {token
              ? 'Skopiuj token teraz - po zamknięciu okna nie będzie już widoczny.'
              : 'Token pozwoli Claude (Desktop / claude.ai) łączyć się z Twoim biurem przez MCP.'}
          </DialogDescription>
        </DialogHeader>

        {!token && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-token-name">Nazwa (np. urządzenie)</Label>
              <Input
                id="mcp-token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mój Claude Desktop (laptop biuro)"
                maxLength={60}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim() && !createMut.isPending) {
                    void handleCreate();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">Pomaga rozpoznać token na liście.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-token-days">Ważność</Label>
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as McpTokenLifetime)}>
                <SelectTrigger id="mcp-token-days">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_TOKEN_LIFETIMES.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} dni
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Po tym czasie token przestanie działać - wygeneruj wtedy nowy. Można go wcześniej
                unieważnić jednym kliknięciem. Token działa bez kodu 2FA, więc wybierz najkrótszy
                okres, który Ci wystarczy.
              </p>
            </div>
          </div>
        )}

        {token && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <strong>Skopiuj teraz.</strong> Token sha256 jest zapisany w bazie - plaintext nie
              będzie już dostępny po zamknięciu tego okna.
            </div>

            <div className="space-y-2">
              <Label>Token</Label>
              <div className="flex gap-2">
                <code className="flex-1 break-all rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs">
                  {token}
                </code>
                <Button onClick={handleCopy} variant="outline" size="icon" title="Kopiuj">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <McpConfigInstructions token={token} />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {!token ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={createMut.isPending}>
                Anuluj
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim() || createMut.isPending}>
                {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Wygeneruj token
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Gotowe</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
