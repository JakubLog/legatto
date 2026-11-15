import { useFieldArray, useFormContext } from 'react-hook-form';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SiteContent } from '@/lib/siteContent';

import { fieldId } from './fieldId';
import { FieldMessage, RowControls, TextField } from './fields';

const MAX_STEPS = 6;

/** Kroki "jak to działa" w sekcji zgłoszenia: dodawanie, usuwanie, zmiana kolejności. */
export function SubmitStepsField() {
  const { control, getFieldState, formState } = useFormContext<SiteContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'homepage.submit.steps' });
  const listError = getFieldState('homepage.submit.steps', formState).error;
  const listId = fieldId('homepage.submit.steps');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Kroki <span className="font-normal text-muted-foreground">({fields.length}/{MAX_STEPS})</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fields.length >= MAX_STEPS}
          onClick={() => append({ title: '', text: '' }, { shouldFocus: true })}
        >
          <Plus className="h-4 w-4" />
          Dodaj krok
        </Button>
      </div>

      {fields.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Brak kroków - sekcja pokaże sam formularz.
        </p>
      )}

      <ol className="space-y-2">
        {fields.map((field, index) => (
          // Wąsko: numer i przyciski w jednym wierszu, pola na pełną szerokość pod nimi.
          <li key={field.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3 @md:flex-nowrap @md:items-start">
            <span
              className="order-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary @md:mt-7"
              aria-hidden
            >
              {index + 1}
            </span>
            <div className="order-3 grid min-w-0 basis-full gap-2 @md:order-2 @md:flex-1 @md:basis-auto @md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <TextField name={`homepage.submit.steps.${index}.title`} label={`Krok ${index + 1} - tytuł`} />
              <TextField name={`homepage.submit.steps.${index}.text`} label="Opis" multiline rows={2} />
            </div>
            <RowControls
              itemLabel={`krok ${index + 1}`}
              index={index}
              count={fields.length}
              onMove={move}
              onRemove={() => remove(index)}
              className="order-2 ml-auto @md:order-3 @md:ml-0 @md:mt-6 @md:self-start"
            />
          </li>
        ))}
      </ol>

      <FieldMessage id={listId} error={listError?.message ?? listError?.root?.message} />
    </div>
  );
}
