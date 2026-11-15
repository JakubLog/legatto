import { useWatch } from 'react-hook-form';
import { Sparkles } from 'lucide-react';

import { SettingsCard } from '@/components/admin/AdminUi';
import { mpForms } from '@/lib/mpForms';
import type { SiteContent } from '@/lib/siteContent';

import { TextField } from './fields';

/** Pierwsza sekcja strony: nadtytuł, opis i dwa przyciski. */
export function HeroCard() {
  // Tytuł karty z danymi posła (IdentityCard) zależy od formy tytułu.
  const identityCard = mpForms(useWatch<SiteContent, 'identity.mp_gender'>({ name: 'identity.mp_gender' })).nominative;
  return (
    <SettingsCard icon={Sparkles} title="Hero" description="Pierwszy ekran strony głównej, obok zdjęcia posła.">
      <div className="grid gap-3 @md:grid-cols-2">
        <TextField
          name="homepage.hero.kicker"
          label="Nadtytuł"
          placeholder={`Domyślnie: okręg wyborczy z karty „${identityCard}”`}
          hint={`Krótka linia nad nagłówkiem hero. Puste pole wstawia okręg wyborczy z karty „${identityCard}”.`}
          className="@md:col-span-2"
        />
        <TextField
          name="homepage.hero.lead"
          label="Opis"
          multiline
          placeholder="Sprawy wyborców, spotkania w terenie, interwencje u urzędów."
          className="@md:col-span-2"
          hint="Puste pole ukrywa opis."
        />
        <TextField
          name="homepage.hero.primary_cta"
          label="Główny przycisk"
          placeholder="Zgłoś sprawę"
          hint="Prowadzi do sekcji „Zgłoś sprawę”. Znika, gdy sekcja jest ukryta."
        />
        <TextField
          name="homepage.hero.secondary_cta"
          label="Drugi przycisk"
          placeholder="Znajdź biuro"
          hint="Prowadzi do sekcji biur. Znika, gdy sekcja jest ukryta."
        />
      </div>
    </SettingsCard>
  );
}
