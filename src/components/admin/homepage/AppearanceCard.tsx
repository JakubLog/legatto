import type { CSSProperties } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Check, Palette } from 'lucide-react';

import { SettingsCard } from '@/components/admin/AdminUi';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BRAND_COLOR_PRESETS,
  PUBLIC_TEMPLATE_LIST,
  PUBLIC_TEMPLATES,
  resolveBrand,
  textColorOn,
  type PublicTemplate,
} from '@/lib/publicTheme';
import { HEX_COLOR, type SiteContent } from '@/lib/siteContent';

import { fieldId } from './fieldId';
import { FieldGroup, TextField } from './fields';

const TEMPLATE_NAME = 'homepage.appearance.template';
const BRAND_NAME = 'homepage.appearance.brand_color';

const hsl = (value: string) => `hsl(${value})`;

/** Miniatura strony w danym szablonie: tła, karty, układ hero i sekcji biur, kolor przewodni (po korekcie kontrastu). */
function TemplatePreview({ template, brandColor }: { template: PublicTemplate; brandColor: string }) {
  const { palette: p, hero, sections } = template;
  const brand = resolveBrand(template, brandColor, false);
  const band = hero === 'band';
  const heroBg = band ? brand.usedHex : hsl(p.card);
  const heroText = band ? brand.foregroundHex : hsl(p.foreground);
  const accent = band ? brand.foregroundHex : brand.usedHex;
  const radius = `min(${template.cardRadius}, 6px)`;
  const line = (width: string, color: string, height = 4): CSSProperties => ({
    width,
    height,
    borderRadius: 2,
    background: color,
  });

  return (
    <div aria-hidden className="overflow-hidden rounded-md border" style={{ background: hsl(p.background) }}>
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: `1px solid ${hsl(p.border)}` }}>
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: brand.usedHex }} />
        <span style={line('28%', hsl(p.foreground), 3)} />
        <span className="ml-auto" style={line('12%', hsl(p['muted-foreground']), 3)} />
      </div>
      <div
        className={cn('flex gap-2 px-2 py-2.5', hero === 'centered' && 'flex-col items-center', hero === 'split-reverse' && 'flex-row-reverse')}
        style={{ background: heroBg }}
      >
        {hero === 'centered' && <span className="h-5 w-5 rounded-full" style={{ background: brand.usedHex }} />}
        <div className={cn('flex w-full flex-1 flex-col gap-1', hero === 'centered' && 'items-center')}>
          <span style={line('70%', heroText, 5)} />
          <span style={line('48%', accent, 5)} />
          <span className="mt-1" style={{ ...line('30%', accent, 7), borderRadius: radius }} />
        </div>
        {hero !== 'centered' && (
          <span className="w-[26%] self-stretch" style={{ background: band ? brand.foregroundHex : brand.usedHex, borderRadius: radius, opacity: band ? 0.9 : 1 }} />
        )}
      </div>
      {/* Sekcja biur: mapa obok kart (po lewej albo po prawej) albo karty w rzędzie i mapa pod nimi. */}
      <div className={cn('flex gap-1.5 p-2', sections.offices === 'end' && 'flex-row-reverse', sections.offices === 'stacked' && 'flex-col-reverse items-center')}>
        <span
          className={cn(sections.offices === 'stacked' ? 'h-6 w-1/2' : 'w-[42%] self-stretch')}
          style={{ background: hsl(p['cream-2']), border: `1px solid ${hsl(p.border)}`, borderRadius: radius }}
        />
        <span className={cn('flex flex-1 gap-1.5', sections.offices === 'stacked' ? 'w-full' : 'flex-col')}>
          {[0, 1].map((i) => (
            <span
              key={i}
              className="flex h-6 flex-1 flex-col justify-center gap-1 px-1.5"
              style={{ background: hsl(p.card), border: `1px solid ${hsl(p.border)}`, borderRadius: radius }}
            >
              <span style={line('60%', hsl(p.foreground), 3)} />
              <span style={line('40%', hsl(p['muted-foreground']), 2)} />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** Szablon strony publicznej (5 do wyboru) i kolor przewodni. */
export function AppearanceCard() {
  const { register, setValue } = useFormContext<SiteContent>();
  const templateId = useWatch<SiteContent, typeof TEMPLATE_NAME>({ name: TEMPLATE_NAME });
  const brandColor = useWatch<SiteContent, typeof BRAND_NAME>({ name: BRAND_NAME });
  const template = PUBLIC_TEMPLATES[templateId];
  const validBrand = HEX_COLOR.test(brandColor) ? brandColor.toLowerCase() : '';
  const resolved = resolveBrand(template, validBrand, false);
  const colorInputId = `${fieldId(BRAND_NAME)}-picker`;

  const setBrand = (value: string) => setValue(BRAND_NAME, value, { shouldDirty: true, shouldValidate: true });

  const current = brandColor.trim().toLowerCase();

  return (
    <SettingsCard
      icon={Palette}
      title="Wygląd"
      description="Szablon strony głównej i kolor przewodni: przyciski, wyróżnienia, nadtytuły i belka promocyjna."
    >
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold text-muted-foreground">Szablon</legend>
          <div className="grid gap-3 @sm:grid-cols-2 @xl:grid-cols-3">
            {PUBLIC_TEMPLATE_LIST.map((option) => {
              const selected = option.id === templateId;
              return (
                <label key={option.id} className="relative block cursor-pointer">
                  <input type="radio" value={option.id} className="peer sr-only" {...register(TEMPLATE_NAME)} />
                  <span
                    className={cn(
                      'flex h-full flex-col gap-2 rounded-lg border bg-card p-2.5 transition-colors hover:bg-muted/40',
                      'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                      selected && 'border-primary ring-1 ring-primary',
                    )}
                  >
                    <TemplatePreview template={option} brandColor={validBrand} />
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold" style={{ fontFamily: option.fontHeading }}>
                          {option.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">{option.description}</span>
                      </span>
                      {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <FieldGroup
          title="Kolor przewodni"
          description="Pusty wybór = kolor domyślny szablonu. Odcień zbyt jasny (albo w szablonie Ciemny zbyt ciemny) na tle strony jest automatycznie korygowany, żeby tekst był czytelny."
        >
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gotowe kolory">
            <button
              type="button"
              aria-pressed={current === ''}
              onClick={() => setBrand('')}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11',
                current === '' && 'border-primary ring-1 ring-primary',
              )}
            >
              <span className="h-4 w-4 rounded-full border" style={{ background: template.defaultBrand }} aria-hidden />
              Domyślny szablonu
            </button>
            {BRAND_COLOR_PRESETS.map((preset) => {
              const active = current === preset.hex;
              return (
                <button
                  key={preset.hex}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={active}
                  onClick={() => setBrand(preset.hex)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 border-background ring-1 ring-border transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:w-11',
                    active && 'ring-2 ring-primary',
                  )}
                  style={{ background: preset.hex }}
                >
                  {active && <Check className="h-4 w-4" style={{ color: textColorOn(preset.hex) }} aria-hidden />}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 @md:grid-cols-[auto_minmax(0,1fr)] @md:items-start">
            <div className="space-y-1.5">
              <Label htmlFor={colorInputId}>Własny kolor</Label>
              <input
                id={colorInputId}
                type="color"
                value={resolved.chosenHex}
                onChange={(e) => setBrand(e.target.value)}
                className="block h-10 w-20 cursor-pointer rounded-md border bg-background p-1 max-md:h-11"
              />
            </div>
            <TextField
              name={BRAND_NAME}
              label="Kod koloru"
              placeholder={`Domyślny szablonu: ${template.defaultBrand}`}
              hint="Format #RRGGBB, np. #c8102e. Puste pole = kolor domyślny szablonu."
            />
          </div>

          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <span className="h-4 w-4 shrink-0 rounded-full border" style={{ background: resolved.usedHex }} aria-hidden />
            {resolved.adjusted ? (
              <span>
                Na stronie: <span className="font-mono">{resolved.usedHex}</span> - odcień{' '}
                {template.dark ? 'rozjaśniony' : 'przyciemniony'} względem {resolved.chosenHex}, żeby tekst w tym kolorze
                miał kontrast co najmniej 4,5:1 (WCAG AA).
              </span>
            ) : (
              <span>
                Na stronie: <span className="font-mono">{resolved.usedHex}</span> - kontrast z tłem szablonu w normie WCAG AA.
              </span>
            )}
          </p>
        </FieldGroup>
      </div>
    </SettingsCard>
  );
}
