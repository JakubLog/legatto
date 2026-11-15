import { useRef, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Atrybut `accept` pola pliku (np. ".pdf,.docx"). */
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  hint?: ReactNode;
  className?: string;
}

/** Strefa upuszczania z przyciskiem wyboru plików (klawiatura: Enter/spacja otwiera wybór). */
export function FileDropZone({ accept, multiple = true, disabled, onFiles, hint, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dragging ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <Upload className="h-5 w-5 text-primary" aria-hidden />
      <span className="font-medium">
        Przeciągnij pliki tutaj albo <span className="text-primary underline-offset-2 hover:underline">wybierz z dysku</span>
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
