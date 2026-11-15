import { useRef } from 'react';
import { Paperclip, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  files: File[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function PendingAttachmentsPicker({ files, onAdd, onRemove, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('Nieobsługiwany format pliku', {
        description: 'Dozwolone: PDF, JPG, PNG, WebP, DOC, DOCX, TXT',
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Plik za duży', { description: 'Maksymalny rozmiar: 10 MB' });
      return;
    }

    onAdd(file);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Załączniki
          {files.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{files.length}</span>
          )}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload />
          Dodaj plik
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt"
          onChange={handleFileChange}
        />
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Pliki zostaną wgrane po dodaniu sprawy. Maksymalnie 10 MB / plik.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f, idx) => (
            <li
              key={`${f.name}-${idx}`}
              className="flex min-h-10 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm max-md:py-0 max-md:pr-1"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(f.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive max-md:h-11 max-md:w-11"
                disabled={disabled}
                onClick={() => onRemove(idx)}
                aria-label="Usuń plik z listy"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
