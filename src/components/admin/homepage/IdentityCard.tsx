import { useFormContext, useWatch } from 'react-hook-form';
import { UserRound } from 'lucide-react';

import { SettingsCard } from '@/components/admin/AdminUi';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mpForms } from '@/lib/mpForms';
import type { SiteContent, SiteIdentity } from '@/lib/siteContent';

import { fieldId } from './fieldId';
import { FieldMessage, TextField } from './fields';
import { SitePhotoField } from './SitePhotoField';

const GENDER = 'identity.mp_gender' as const;

/** Dane posła wspólne dla całej strony publicznej (nagłówek, hero, stopka, zgody RODO). */
export function IdentityCard() {
  const { control, setValue } = useFormContext<SiteContent>();
  const gender = useWatch({ control, name: GENDER });
  const forms = mpForms(gender);
  const genderId = fieldId(GENDER);

  return (
    <SettingsCard
      icon={UserRound}
      title={forms.nominative}
      description="Dane posła widoczne w nagłówku, hero i stopce strony oraz w treści zgód formularza."
    >
      <div className="grid gap-3 @md:grid-cols-2">
        <TextField name="identity.mp_name" label="Imię i nazwisko" placeholder="Jan Kowalski" />
        <TextField
          name="identity.mp_name_genitive"
          label="Imię i nazwisko w dopełniaczu"
          placeholder="Jana Kowalskiego"
          hint="Np. „Biuro Poselskie Jana Kowalskiego”."
        />
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={genderId}>Forma tytułu</Label>
          <Select
            value={gender}
            onValueChange={(v) =>
              setValue(GENDER, v as SiteIdentity['mp_gender'], { shouldDirty: true, shouldValidate: true })
            }
          >
            <SelectTrigger id={genderId} aria-describedby={`${genderId}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="m">Poseł</SelectItem>
              <SelectItem value="f">Posłanka</SelectItem>
            </SelectContent>
          </Select>
          <FieldMessage
            id={genderId}
            hint="Odmiana w całym systemie: role, teksty portalu, zgody RODO i newsletter."
          />
        </div>
        <TextField
          name="identity.mp_title"
          label="Tytuł"
          placeholder={`${forms.nominative} na Sejm RP`}
          hint="Np. „Poseł na Sejm RP” albo „Posłanka na Sejm RP”."
        />
        <TextField
          name="identity.district_label"
          label="Okręg wyborczy"
          placeholder="Okręg wyborczy nr 13 - Kraków"
          hint="Nadtytuł hero (gdy pole „Nadtytuł” jest puste) i opis mapy dla czytników ekranu."
        />
        <TextField
          name="identity.website_url"
          label="Strona internetowa posła"
          type="url"
          placeholder="https://..."
          hint="Link w stopce (Kontakt); puste pole go ukrywa. Link w menu ustawiasz w karcie „Nawigacja”."
        />
        <div className="@md:col-span-2">
          <SitePhotoField />
        </div>
      </div>
    </SettingsCard>
  );
}
