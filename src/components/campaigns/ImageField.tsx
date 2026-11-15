import { useId, useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadNewsletterAsset } from '@/hooks/useNewsletterAssets';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
  description?: string;
  error?: string;
  required?: boolean;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/** Kompaktowe pole zdjęcia: miniatura + upload (klik / przeciągnij / wklej) albo link. */
export function ImageField({ label, value, onChange, description, error, required }: Props) {
  const { profile } = useAuth();
  const uploadMut = useUploadNewsletterAsset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [broken, setBroken] = useState(false);
  const urlInputId = useId();

  const handleFile = async (file: File) => {
    if (!profile) {
      toast.error('Brak sesji użytkownika');
      return;
    }
    try {
      const result = await uploadMut.mutateAsync({ userId: profile.id, file });
      setBroken(false);
      onChange(result.public_url);
    } catch (err) {
      toast.error('Nie udało się wgrać zdjęcia', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const uploading = uploadMut.isPending;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={urlInputId}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
          if (file) {
            e.preventDefault();
            void handleFile(file);
          }
        }}
        className={cn(
          'flex items-center gap-3 rounded-lg border border-dashed p-2 transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
          error && 'border-destructive/60',
        )}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label={value ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
          className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : value && !broken ? (
            <img src={value} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
          ) : (
            <ImagePlus className="h-5 w-5" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          {value ? (
            <p className={cn('truncate text-xs', broken ? 'text-destructive' : 'text-muted-foreground')} title={value}>
              {/* CSP portalu (img-src) wpuszcza tylko storage instancji - zewnętrzny link nie ma podglądu. */}
              {broken ? 'Brak podglądu z tego adresu (portal pokazuje tylko wgrane pliki)' : value.split('/').pop()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {uploading ? 'Wgrywam…' : 'Przeciągnij, wklej (Ctrl+V) lub wybierz plik. Max 5 MB.'}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium max-md:gap-y-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50 max-md:min-h-10 max-md:px-2">
              <Upload className="h-3 w-3" />
              {value ? 'Zmień' : 'Wybierz plik'}
            </button>
            <button
              type="button"
              onClick={() => setShowUrl((v) => !v)}
              aria-expanded={showUrl}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground max-md:min-h-10 max-md:px-2"
            >
              <Link2 className="h-3 w-3" />
              {showUrl ? 'Ukryj link' : 'Wklej link'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setBroken(false);
                }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive max-md:min-h-10 max-md:px-2"
              >
                <Trash2 className="h-3 w-3" />
                Usuń
              </button>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {showUrl && (
        <Input
          id={urlInputId}
          type="url"
          value={value}
          onChange={(e) => {
            setBroken(false);
            onChange(e.target.value);
          }}
          placeholder="https://..."
          autoComplete="off"
          autoFocus
        />
      )}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        description && <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
