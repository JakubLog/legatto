import { useId } from 'react';
import {
  Accessibility,
  CirclePause,
  Contrast,
  Focus,
  Palette,
  RotateCcw,
  Underline,
  WholeWord,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsSection } from '@/components/common/SettingsSection';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import {
  DEFAULT_A11Y_SETTINGS,
  isDefaultAccessibility,
  saveAccessibilitySettings,
  TEXT_SCALES,
  type AccessibilitySettings,
  type TextScale,
} from '@/lib/accessibility';
import { cn } from '@/lib/utils';

/** `sample` - próbka "Aa" w proporcji odpowiadającej skali (16 / 18 / 20 / 24 px przy 100%). */
const TEXT_SCALE_LABELS: Record<TextScale, { name: string; value: string; sample: string }> = {
  100: { name: 'Standardowy', value: '100%', sample: 'text-base' },
  112: { name: 'Większy', value: '112,5%', sample: 'text-lg' },
  125: { name: 'Duży', value: '125%', sample: 'text-xl' },
  150: { name: 'Bardzo duży', value: '150%', sample: 'text-2xl' },
};

type FlagKey = Exclude<keyof AccessibilitySettings, 'textScale'>;

const FLAGS: { key: FlagKey; icon: LucideIcon; title: string; description: string }[] = [
  {
    key: 'highContrast',
    icon: Contrast,
    title: 'Wysoki kontrast',
    description: 'Ciemniejszy tekst pomocniczy oraz wyraźne obramowania pól, kart i separatorów.',
  },
  {
    key: 'reduceMotion',
    icon: CirclePause,
    title: 'Ograniczenie animacji',
    description: 'Wyłącza animacje, przejścia i płynne przewijanie.',
  },
  {
    key: 'underlineLinks',
    icon: Underline,
    title: 'Podkreślanie linków',
    description: 'Linki w tekście są podkreślone, więc nie trzeba ich rozróżniać po kolorze.',
  },
  {
    key: 'colorBlind',
    icon: Palette,
    title: 'Kolory dla daltonistów',
    description:
      'Zielony (np. sprawa załatwiona, budżet w limicie, sukces) zmienia się na niebieski, żeby nie mylił się z czerwonym i pomarańczowym przy zaburzeniach widzenia barw czerwono-zielonych.',
  },
  {
    key: 'strongFocus',
    icon: Focus,
    title: 'Wyraźny wskaźnik fokusu',
    description: 'Gruby obrys wokół aktywnego elementu podczas poruszania się klawiaturą (Tab).',
  },
  {
    key: 'readableSpacing',
    icon: WholeWord,
    title: 'Odstępy ułatwiające czytanie',
    description: 'Większe odstępy między literami, słowami i wierszami, pomocne m.in. przy dysleksji.',
  },
];

export function AccessibilitySettingsSection() {
  const { settings, systemReducedMotion } = useAccessibilitySettings();
  const baseId = useId();
  const isDefault = isDefaultAccessibility(settings);
  const update = (patch: Partial<AccessibilitySettings>) => saveAccessibilitySettings({ ...settings, ...patch });

  return (
    <SettingsSection
      icon={Accessibility}
      title="Ustawienia dostępności"
      description="Dopasuj wygląd aplikacji do swoich potrzeb. Zmiany działają od razu i są zapisywane tylko na tym urządzeniu."
    >
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Rozmiar tekstu</legend>
          <div className="grid grid-cols-2 gap-2 @sm:grid-cols-4">
            {TEXT_SCALES.map((scale) => {
              const label = TEXT_SCALE_LABELS[scale];
              const selected = settings.textScale === scale;
              return (
                <label
                  key={scale}
                  className={cn(
                    'flex min-h-16 cursor-pointer flex-col items-center justify-end gap-0.5 rounded-lg border px-2 pb-2 pt-1.5 text-center transition-colors hover:bg-muted/60',
                    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
                    selected && 'border-primary bg-primary/5 text-primary ring-1 ring-primary hover:bg-primary/10',
                  )}
                >
                  <input
                    type="radio"
                    name={`${baseId}-text-scale`}
                    value={scale}
                    checked={selected}
                    onChange={() => update({ textScale: scale })}
                    className="sr-only"
                  />
                  <span aria-hidden className={cn('font-semibold leading-none', label.sample)}>
                    Aa
                  </span>
                  <span className="sr-only">{label.name}, </span>
                  <span className={cn('text-xs tabular-nums', selected ? 'font-medium' : 'text-muted-foreground')}>
                    {label.value}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Powiększa tekst i elementy interfejsu w całej aplikacji, niezależnie od powiększenia przeglądarki.
          </p>
        </fieldset>

        <ul className="divide-y rounded-lg border">
          {FLAGS.map(({ key, icon: Icon, title, description }) => {
            const id = `${baseId}-${key}`;
            const checked = key === 'reduceMotion' ? (settings.reduceMotion ?? systemReducedMotion) : settings[key];
            const motionNote =
              key === 'reduceMotion' && settings.reduceMotion === null
                ? ` Domyślnie zgodnie z systemem (teraz ${systemReducedMotion ? 'włączone' : 'wyłączone'}).`
                : '';
            return (
              <li key={key}>
                <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span id={`${id}-title`} className="block text-sm font-medium leading-snug">
                      {title}
                    </span>
                    <span id={`${id}-desc`} className="block text-xs text-muted-foreground">
                      {description}
                      {motionNote}
                    </span>
                  </span>
                  <Switch
                    id={id}
                    checked={checked}
                    onCheckedChange={(value) => update({ [key]: value })}
                    aria-labelledby={`${id}-title`}
                    aria-describedby={`${id}-desc`}
                    className="mt-0.5"
                  />
                </label>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-md:w-full"
            onClick={() => saveAccessibilitySettings(DEFAULT_A11Y_SETTINGS)}
            disabled={isDefault}
          >
            <RotateCcw />
            Przywróć domyślne
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
