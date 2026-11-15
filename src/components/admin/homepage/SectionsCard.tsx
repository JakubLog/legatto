import type { ComponentType } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { CalendarDays, LayoutList, MapPin, Send, type LucideIcon } from 'lucide-react';

import { SettingsCard } from '@/components/admin/AdminUi';
import { cn } from '@/lib/utils';
import { HOMEPAGE_SECTION_ANCHORS, type HomepageSectionId, type SiteContent } from '@/lib/siteContent';

import { fieldId } from './fieldId';
import { CheckboxField, FieldMessage, RowControls, TextField } from './fields';
import { SubmitStepsField } from './SubmitStepsField';

const SECTION_META: Record<HomepageSectionId, { label: string; Icon: LucideIcon }> = {
  offices: { label: 'Biura', Icon: MapPin },
  calendar: { label: 'Kalendarz', Icon: CalendarDays },
  submit: { label: 'Zgłoś sprawę', Icon: Send },
};

const NAV_LABEL_HINT = 'Pozycja w menu strony, prowadzi do tej sekcji.';

function OfficesFields() {
  const { control, setValue } = useFormContext<SiteContent>();
  const showMap = useWatch({ control, name: 'homepage.offices.show_map' });

  return (
    <div className="grid gap-3 @md:grid-cols-2">
      <TextField name="homepage.offices.nav_label" label="Etykieta w menu" hint={NAV_LABEL_HINT} />
      <TextField name="homepage.offices.title" label="Tytuł sekcji" />
      <CheckboxField
        id={fieldId('homepage.offices.show_map')}
        label="Pokazuj mapę okręgu"
        description="Mapa wymaga plików granic okręgu tej instancji (scripts/build-okreg-geojson.mjs)."
        checked={showMap}
        onChange={(checked) => setValue('homepage.offices.show_map', checked, { shouldDirty: true })}
        className="@md:col-span-2"
      />
      {showMap && (
        <TextField
          name="homepage.offices.map_caption"
          label="Podpis mapy"
          placeholder="Biura w okręgu wyborczym"
          hint="Puste pole ukrywa podpis."
        />
      )}
      <TextField
        name="homepage.offices.empty_text"
        label="Tekst, gdy brak biur"
        placeholder="Lista biur pojawi się wkrótce."
      />
    </div>
  );
}

function CalendarFields() {
  return (
    <div className="grid gap-3 @md:grid-cols-2">
      <TextField name="homepage.calendar.nav_label" label="Etykieta w menu" hint={NAV_LABEL_HINT} />
      <TextField name="homepage.calendar.title" label="Tytuł sekcji" />
      <TextField
        name="homepage.calendar.description"
        label="Opis"
        multiline
        rows={2}
        className="@md:col-span-2"
      />
    </div>
  );
}

function SubmitFields() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 @md:grid-cols-2">
        <TextField name="homepage.submit.nav_label" label="Etykieta w menu" hint={NAV_LABEL_HINT} />
        <TextField name="homepage.submit.title" label="Tytuł sekcji" />
        <TextField name="homepage.submit.description" label="Opis" multiline rows={2} className="@md:col-span-2" />
      </div>
      <SubmitStepsField />
    </div>
  );
}

const SECTION_FIELDS: Record<HomepageSectionId, ComponentType> = {
  offices: OfficesFields,
  calendar: CalendarFields,
  submit: SubmitFields,
};

/** Sekcje strony głównej pod hero: kolejność, widoczność i treść każdej z nich. */
export function SectionsCard() {
  const { control, setValue, getFieldState, formState } = useFormContext<SiteContent>();
  const sections = useWatch({ control, name: 'homepage.sections' });
  const listError = getFieldState('homepage.sections', formState).error;

  const update = (next: SiteContent['homepage']['sections']) =>
    setValue('homepage.sections', next, { shouldDirty: true, shouldValidate: true });

  const move = (from: number, to: number) => {
    const next = [...sections];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    update(next);
  };

  const toggle = (index: number, enabled: boolean) =>
    update(sections.map((s, i) => (i === index ? { ...s, enabled } : s)));

  return (
    <SettingsCard
      icon={LayoutList}
      title="Sekcje"
      description="Kolejność i widoczność sekcji pod hero. Ukryta sekcja znika też z menu i stopki strony."
    >
      <ol className="space-y-4">
        {sections.map((section, index) => {
          const { label, Icon } = SECTION_META[section.id];
          const Fields = SECTION_FIELDS[section.id];
          return (
            <li key={section.id} className="overflow-hidden rounded-lg border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted/30 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <h3 className="truncate text-sm font-semibold">
                    {index + 1}. {label}
                  </h3>
                  <span className="hidden text-xs text-muted-foreground @sm:inline">
                    #{HOMEPAGE_SECTION_ANCHORS[section.id]}
                  </span>
                </div>
                <CheckboxField
                  id={fieldId(`homepage.sections.${index}.enabled`)}
                  label="Widoczna"
                  checked={section.enabled}
                  onChange={(checked) => toggle(index, checked)}
                  className="min-h-0 border-0 bg-transparent px-0 py-0 max-md:min-h-11"
                />
                <RowControls itemLabel={`sekcję ${label}`} index={index} count={sections.length} onMove={move} />
              </div>
              <div className={cn('border-t p-3 sm:p-4', !section.enabled && 'opacity-60')}>
                <Fields />
              </div>
            </li>
          );
        })}
      </ol>
      <FieldMessage id={fieldId('homepage.sections')} error={listError?.message ?? listError?.root?.message} />
    </SettingsCard>
  );
}
