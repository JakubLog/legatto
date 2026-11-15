import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { classifyExternalLink } from './linkSafety';

interface ExternalLinkProps {
  href: string;
  children: ReactNode;
}

/**
 * Link z odpowiedzi modelu poza panel biura: host (albo adresat maila) widoczny obok tekstu,
 * a adres spoza zaufanych hostów lub z parametrami otwiera się dopiero po potwierdzeniu
 * z pełnym adresem (`linkSafety.ts`).
 */
export function ExternalLink({ href, children }: ExternalLinkProps) {
  const [confirming, setConfirming] = useState(false);
  const info = classifyExternalLink(href, window.location.origin);
  if (!info) return <span>{children}</span>;
  const isMail = /^mailto:/i.test(href);
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => {
          if (!info.confirm) return;
          e.preventDefault();
          setConfirming(true);
        }}
        // Środkowy przycisk myszy otwiera kartę bez zdarzenia click.
        onAuxClick={(e) => {
          if (!info.confirm || e.button !== 1) return;
          e.preventDefault();
          setConfirming(true);
        }}
        className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
      >
        {children}
      </a>
      {info.label && <span className="ml-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">({info.label})</span>}
      {info.confirm && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isMail ? 'Otworzyć wiadomość e-mail?' : 'Otworzyć stronę zewnętrzną?'}</AlertDialogTitle>
              <AlertDialogDescription>
                Link pochodzi z odpowiedzi PoliAI i prowadzi poza panel biura. Sprawdź pełny adres - nie otwieraj go,
                jeśli zawiera dane z rozmowy albo nieznany adres.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {info.label && (
              <p className="text-sm">
                {isMail ? 'Adresat' : 'Host'}: <span className="font-semibold [overflow-wrap:anywhere]">{info.label}</span>
              </p>
            )}
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs" tabIndex={0}>
              {href}
            </pre>
            <AlertDialogFooter>
              <AlertDialogCancel>Anuluj</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => (isMail ? window.location.assign(href) : window.open(href, '_blank', 'noopener,noreferrer'))}
              >
                Otwórz
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
