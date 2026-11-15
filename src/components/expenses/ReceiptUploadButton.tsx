import { useRef, useState } from 'react';
import { Camera, Eye, FileText, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadReceipt } from '@/hooks/useReceipts';
import { RECEIPT_MAX_BYTES, isAllowedReceiptMime, isReceiptPdf } from '@/lib/expenses';
import { errorMessage } from '@/lib/errors';
import { ReceiptViewer } from './ReceiptViewer';

interface Props {
  receiptPath: string | null;
  receiptMime: string | null;
  onUploaded: (path: string, mime: string) => void;
  onCleared: () => void;
}

const MAX_IMAGE_SIDE = 2560;

/**
 * Zdjęcia z telefonu często przekraczają limit 5 MB (lub są w HEIC) - zmniejszamy je w przeglądarce do JPEG.
 * Pozostałe pliki bez zmian; walidację typu/rozmiaru i tak robi useUploadReceipt.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (isAllowedReceiptMime(file.type) && file.size <= RECEIPT_MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return file;
  const base = file.name.replace(/\.[^.]+$/, '') || 'zdjecie';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

export function ReceiptUploadButton({ receiptPath, receiptMime, onUploaded, onCleared }: Props) {
  const { profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadMut = useUploadReceipt();
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked || !profile) return;
    try {
      const file = await shrinkImage(picked);
      const { path, mime } = await uploadMut.mutateAsync({ userId: profile.id, file });
      onUploaded(path, mime);
      toast.success('Załącznik wgrany');
    } catch (err) {
      toast.error('Błąd uploadu', { description: errorMessage(err) });
    }
  };

  const Icon = isReceiptPdf(receiptMime) ? FileText : ImageIcon;
  // Ścieżka: `<user_id>/<timestamp>-<nazwa>` - znacznik czasu to szczegół techniczny, w UI sama nazwa pliku.
  const filename = receiptPath?.split('/').pop()?.replace(/^\d+-/, '') ?? '';

  return (
    <div className="space-y-2">
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFile}
      />
      {/* Telefon: bezpośrednio aparat (zdjęcie paragonu). */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraInputRef}
        className="hidden"
        onChange={handleFile}
      />

      {receiptPath ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px]" title={filename}>
            {filename}
          </span>
          <div className="flex gap-2 max-md:w-full md:contents">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:min-w-0 max-md:flex-1"
              onClick={() => setPreviewOpen(true)}
              aria-label="Podgląd załącznika"
            >
              <Eye className="h-4 w-4" /> <span>Podgląd</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-md:min-w-0 max-md:flex-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
              aria-label="Zmień załącznik"
            >
              {uploadMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span>Zmień</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive max-md:min-w-0 max-md:flex-1"
              onClick={onCleared}
              aria-label="Usuń załącznik"
            >
              <Trash2 className="h-4 w-4" /> <span>Usuń</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-3 md:flex-row md:items-center max-md:items-stretch max-md:gap-3">
          <Button
            type="button"
            className="md:hidden"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploadMut.isPending}
          >
            {uploadMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Zrób zdjęcie
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:h-11"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMut.isPending}
          >
            {uploadMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Wgraj fakturę / paragon
          </Button>
          <p className="text-xs text-muted-foreground">PDF / JPG / PNG / WebP, max 5 MB.</p>
        </div>
      )}

      {previewOpen && (
        <ReceiptViewer
          path={receiptPath}
          mime={receiptMime}
          title={filename}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
