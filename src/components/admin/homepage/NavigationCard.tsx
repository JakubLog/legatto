import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Megaphone, Plus } from 'lucide-react';

import { SettingsCard } from '@/components/admin/AdminUi';
import { Button } from '@/components/ui/button';
import type { SiteContent } from '@/lib/siteContent';

import { fieldId } from './fieldId';
import { CheckboxField, FieldGroup, RowControls, TextField } from './fields';

const MAX_LINKS = 4;

function ExternalLinksField() {
  const { control } = useFormContext<SiteContent>();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'homepage.external_links' });

  return (
    <FieldGroup
      title={`Linki zewnętrzne w menu (${fields.length}/${MAX_LINKS})`}
      description="Dodatkowe pozycje menu strony, np. „O Pośle” albo profil w mediach społecznościowych. Otwierają się w nowej karcie."
    >
      {fields.length > 0 && (
        <ul className="space-y-2">
          {fields.map((field, index) => (
            <li key={field.id} className="flex gap-2 rounded-lg border bg-muted/20 p-3">
              <div className="grid min-w-0 flex-1 gap-2 @md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <TextField name={`homepage.external_links.${index}.label`} label="Etykieta" placeholder="O Pośle" />
                <TextField name={`homepage.external_links.${index}.href`} label="Adres" type="url" placeholder="https://..." />
              </div>
              <RowControls
                itemLabel={`link ${index + 1}`}
                index={index}
                count={fields.length}
                onMove={move}
                onRemove={() => remove(index)}
                className="mt-6 flex-col self-start @md:flex-row"
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fields.length >= MAX_LINKS}
        onClick={() => append({ label: '', href: '' }, { shouldFocus: true })}
      >
        <Plus className="h-4 w-4" />
        Dodaj link
      </Button>
    </FieldGroup>
  );
}

function PromoFields() {
  const { control, setValue } = useFormContext<SiteContent>();
  const enabled = useWatch({ control, name: 'homepage.promo.enabled' });

  return (
    <FieldGroup title="Belka promocyjna" description="Pasek nad nagłówkiem strony, np. z projektem lub inicjatywą posła.">
      <CheckboxField
        id={fieldId('homepage.promo.enabled')}
        label="Pokazuj belkę promocyjną"
        checked={enabled}
        onChange={(checked) => setValue('homepage.promo.enabled', checked, { shouldDirty: true })}
      />
      <div className="grid gap-3 @md:grid-cols-2">
        <TextField name="homepage.promo.label" label="Etykieta" placeholder="Nasz projekt:" />
        <TextField name="homepage.promo.name" label="Nazwa" placeholder="Nazwa projektu" />
        <TextField name="homepage.promo.text" label="Tekst" multiline rows={2} className="@md:col-span-2" />
        <TextField name="homepage.promo.cta" label="Tekst linku" placeholder="Dowiedz się więcej" />
        <TextField
          name="homepage.promo.href"
          label="Adres linku"
          type="url"
          placeholder="https://..."
          hint="Bez adresu belka się nie pokaże."
        />
      </div>
    </FieldGroup>
  );
}

/** Menu strony publicznej (linki zewnętrzne) i belka promocyjna nad nagłówkiem. */
export function NavigationCard() {
  return (
    <SettingsCard icon={Megaphone} title="Nawigacja i belka" description="Dodatkowe linki w menu oraz pasek promocyjny.">
      <div className="space-y-6 divide-y [&>section+section]:pt-6">
        <ExternalLinksField />
        <PromoFields />
      </div>
    </SettingsCard>
  );
}
