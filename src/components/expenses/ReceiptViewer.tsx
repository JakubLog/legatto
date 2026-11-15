import { ExternalLink, FileText, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useReceiptSignedUrl } from '@/hooks/useReceipts';
import { isReceiptPdf } from '@/lib/expenses';

interface Props {
  path: string | null;
  mime: string | null;
  title?: string;
  onClose: () => void;
}

export function ReceiptViewer({ path, mime, title, onClose }: Props) {
  const { data: url, isLoading, error } = useReceiptSignedUrl(path);
  const open = Boolean(path);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-4 py-3 pr-12 max-md:pr-[3.75rem]">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="truncate text-base">{title ?? 'Załącznik'}</DialogTitle>
            {url && (
              <Button variant="outline" size="sm" className="shrink-0" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Otwórz w nowej karcie">
                  <ExternalLink /> <span className="hidden sm:inline">Otwórz w nowej karcie</span>
                </a>
              </Button>
            )}
          </div>
          <DialogDescription className="sr-only">Podgląd pliku faktury lub paragonu dołączonego do wydatku.</DialogDescription>
        </DialogHeader>
        <div className="h-[70vh] bg-muted/40 p-2 sm:p-3 max-md:h-[70dvh]">
          {isLoading && <Skeleton className="h-full w-full rounded-lg" />}
          {error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <FileWarning className="h-5 w-5" />
              </span>
              <p className="text-sm text-muted-foreground">Nie udało się załadować pliku.</p>
            </div>
          )}
          {url && !isLoading && (
            isReceiptPdf(mime) ? (
              <>
                <iframe
                  src={url}
                  title={title ?? 'receipt'}
                  className="h-full w-full rounded-lg border bg-card max-md:hidden"
                />
                {/* Telefon: przeglądarki mobilne słabo osadzają PDF w iframe - otwieramy natywną przeglądarkę. */}
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center md:hidden">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <p className="text-sm text-muted-foreground">Podgląd PDF otworzy się w przeglądarce telefonu.</p>
                  <Button asChild>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Otwórz PDF
                    </a>
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center overflow-auto">
                <img
                  src={url}
                  alt={title ?? 'receipt'}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-card"
                />
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
