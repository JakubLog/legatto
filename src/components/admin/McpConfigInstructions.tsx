import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/admin/AdminUi';
import { getMcpUrl } from '@/lib/instanceUrls';

interface Props {
  token: string;
}

export function McpConfigInstructions({ token }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const mcpUrl = getMcpUrl();

  const desktopConfig = `{
  "mcpServers": {
    "biuro": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`;

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success('Skopiowano do schowka');
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      toast.error('Nie udało się skopiować');
    }
  };

  return (
    <div className="divide-y rounded-lg border bg-muted/20 text-sm">
      <div className="p-4">
        <p className="mb-1 font-medium">Konfiguracja Claude Desktop</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Otwórz <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-xs">claude_desktop_config.json</code>{' '}
          (Settings → Developer → Edit Config) i wklej:
        </p>
        <div className="relative">
          <CodeBlock className="bg-card pr-12">{desktopConfig}</CodeBlock>
          <Button
            size="icon"
            variant="outline"
            className="absolute right-2 top-2 h-7 w-7"
            onClick={() => handleCopy('desktop', desktopConfig)}
            title="Kopiuj konfigurację"
            aria-label="Kopiuj konfigurację"
          >
            {copiedKey === 'desktop' ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Po zapisaniu zrestartuj Claude Desktop. Serwer pojawi się jako{' '}
          <strong>biuro</strong> z narzędziami w sekcji "Tools".
        </p>
      </div>

      <div className="p-4">
        <p className="mb-2 font-medium">Endpoint i token (do innych klientów MCP)</p>
        <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
          <span className="text-xs text-muted-foreground">URL:</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{mcpUrl}</code>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => handleCopy('url', mcpUrl)}
              aria-label="Kopiuj URL"
            >
              {copiedKey === 'url' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">Header:</span>
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
            Authorization: Bearer epm_***
          </code>
        </div>
      </div>
    </div>
  );
}
