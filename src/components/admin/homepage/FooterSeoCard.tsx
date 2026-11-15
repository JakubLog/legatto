import { PanelBottom } from 'lucide-react';

import { SettingsCard } from '@/components/admin/AdminUi';

import { FieldGroup, TextField } from './fields';

/** Stopka strony oraz tytuł i opis dla wyszukiwarek. */
export function FooterSeoCard() {
  const year = new Date().getFullYear();

  return (
    <SettingsCard icon={PanelBottom} title="Stopka i SEO" description="Dół strony oraz tytuł i opis strony w przeglądarce.">
      <div className="space-y-6 divide-y [&>section+section]:pt-6">
        <FieldGroup title="Stopka">
          <div className="grid gap-3">
            <TextField name="homepage.footer.tagline" label="Opis w stopce" multiline rows={2} />
            <TextField
              name="homepage.footer.copyright"
              label="Prawa autorskie"
              placeholder="Biuro Poselskie"
              hint={`Pojawi się po „© ${year} ”. Puste pole wstawi nazwę biura.`}
            />
          </div>
        </FieldGroup>
        <FieldGroup title="SEO">
          <div className="grid gap-3">
            <TextField
              name="homepage.seo.title"
              label="Tytuł strony"
              placeholder="Biuro Poselskie Jana Kowalskiego"
              hint="Tytuł karty przeglądarki. Podglądy w mediach społecznościowych i roboty bez JavaScriptu nadal widzą tytuł z index.html."
            />
            <TextField
              name="homepage.seo.description"
              label="Opis strony"
              multiline
              rows={2}
              hint="Opis strony (meta description) ustawiany po załadowaniu. Roboty bez JavaScriptu widzą opis z index.html."
            />
          </div>
        </FieldGroup>
      </div>
    </SettingsCard>
  );
}
