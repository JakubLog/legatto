import type { ReactNode } from 'react';
import { useFormContext, type Path } from 'react-hook-form';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { SiteContent } from '@/lib/siteContent';

import { fieldId } from './fieldId';

export type SiteContentPath = Path<SiteContent>;

interface TextFieldProps {
  name: SiteContentPath;
  label: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  type?: 'text' | 'url';
  className?: string;
}

/** Pole tekstowe podpięte do formularza strony głównej: etykieta, podpowiedź, błąd zod. */
export function TextField({ name, label, hint, placeholder, multiline, rows = 3, type = 'text', className }: TextFieldProps) {
  const { register, getFieldState, formState } = useFormContext<SiteContent>();
  const { error } = getFieldState(name, formState);
  const id = fieldId(name);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const common = {
    id,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    ...register(name),
  };

  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea rows={rows} {...common} />
      ) : (
        <Input type={type} autoComplete="off" inputMode={type === 'url' ? 'url' : undefined} {...common} />
      )}
      <FieldMessage id={id} error={error?.message} hint={hint} />
    </div>
  );
}

/** Komunikat pod polem: błąd walidacji ma pierwszeństwo przed podpowiedzią. */
export function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="text-xs text-destructive">
        {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
      {hint}
    </p>
  );
}

interface CheckboxFieldProps {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/** Przełącznik (natywny checkbox jak w innych formularzach portalu) w ramce z opisem. */
export function CheckboxField({ id, label, description, checked, onChange, className }: CheckboxFieldProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm max-md:min-h-11',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary max-md:h-5 max-md:w-5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 space-y-0.5">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

/** Nagłówek grupy pól wewnątrz karty. */
export function FieldGroup({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

interface RowControlsProps {
  /** Nazwa elementu do etykiet dostępności, np. "krok 2". */
  itemLabel: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove?: () => void;
  className?: string;
}

/** Przyciski wiersza listy: przesuń w górę / w dół, opcjonalnie usuń. */
export function RowControls({ itemLabel, index, count, onMove, onRemove, className }: RowControlsProps) {
  return (
    <div className={cn('flex shrink-0 items-center gap-0.5', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        aria-label={`Przesuń ${itemLabel} w górę`}
        title="Przesuń w górę"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
        aria-label={`Przesuń ${itemLabel} w dół`}
        title="Przesuń w dół"
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Usuń ${itemLabel}`}
          title="Usuń"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
