import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

// ============================================================================
// Wspoldzielone prymitywy formularza edytora newslettera
// ============================================================================

export function FormField({
  label,
  required,
  error,
  hint,
  aside,
  children,
}: {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  /** Element po prawej stronie etykiety, np. licznik znaków. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && (
            <Label>
              {label}
              {required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
          )}
          {aside && <span className="ml-auto text-[11px]">{aside}</span>}
        </div>
      )}
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Karta pojedynczego elementu listy (media / wydarzenia / rekomendacje) z przyciskiem usuwania.
export function RepeatableItem({
  index,
  onRemove,
  canRemove,
  children,
}: {
  index: number;
  onRemove: () => void;
  canRemove: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">
          {index + 1}
        </span>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="-mr-1 h-7 gap-1 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
            Usuń
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

export function AddItemButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="outline" size="sm" className="border-dashed" onClick={onClick} disabled={disabled}>
      <Plus />
      {label}
    </Button>
  );
}
