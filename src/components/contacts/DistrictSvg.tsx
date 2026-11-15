import { useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import type { Feature } from 'geojson';
import { Map as MapIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useContactsCountByGmina, useContactsCountByPowiat } from '@/hooks/useContacts';
import { useDistrictConfig, useDistrictGeo, type DistrictGeoLevel } from '@/hooks/useDistrict';
import { useGminy } from '@/hooks/useGminy';
import { usePowiaty } from '@/hooks/usePowiaty';

interface PowiatProps {
  id: number;
  name: string;
  teryt: string;
}

interface GminaProps {
  id: number;
  powiat_id: number;
  name: string;
  type: 'm' | 'w' | 'mw';
  teryt: string;
}

interface Props {
  selectedPowiatId: number | null;
  selectedGminaId: number | null;
  onChange: (v: { powiatId: number | null; gminaId: number | null }) => void;
}

const VIEW_W = 800;
const VIEW_H = 500;

// Skala oparta o tokeny motywu (granat --primary), działa w trybie jasnym i ciemnym.
const SCALE_BUCKETS: { max: number; color: string; label: string }[] = [
  { max: 0,         color: 'hsl(var(--muted))',          label: '0' },
  { max: 4,         color: 'hsl(var(--primary) / 0.2)',  label: '1-4' },
  { max: 19,        color: 'hsl(var(--primary) / 0.45)', label: '5-19' },
  { max: 49,        color: 'hsl(var(--primary) / 0.7)',  label: '20-49' },
  { max: Infinity,  color: 'hsl(var(--primary))',        label: '50+' },
];

const SELECTED_FILL = 'hsl(var(--brand))';
const REGION_STROKE = 'hsl(var(--card))';
const HIGHLIGHT_STROKE = 'hsl(var(--brand))';

function colorFor(count: number, isSelected: boolean): string {
  if (isSelected) return SELECTED_FILL;
  return SCALE_BUCKETS.find((b) => count <= b.max)!.color;
}

function plural(n: number): string {
  if (n === 1) return 'kontakt';
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'kontakty';
  return 'kontaktów';
}

export function DistrictSvg({ selectedPowiatId, selectedGminaId, onChange }: Props) {
  const [level, setLevel] = useState<DistrictGeoLevel>('powiaty');
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<
    { name: string; count: number; isHighlighted: boolean; x: number; y: number } | null
  >(null);

  const { data: district, isLoading: districtLoading, error: districtError } = useDistrictConfig();
  const { data: geo, isLoading: geoLoading, error: geoError } = useDistrictGeo(district?.number, level);
  const { data: powiatCounts = {} } = useContactsCountByPowiat();
  const { data: gminaCounts = {} } = useContactsCountByGmina();
  // Te same zapytania co ContactsFilters (cache React Query) - liczby regionów i opis wyróżnienia.
  const { data: powiaty } = usePowiaty();
  const { data: gminy } = useGminy();
  const highlightedPowiat = powiaty?.find((p) => p.id === district?.highlighted_powiat_id);

  const pathBuilder = useMemo(() => {
    if (!geo) return null;
    // GeoJSON-y muszą mieć winding order: outer=CW, holes=CCW (rewind w build:geo).
    // Bez tego Mercator spherical liczy area=4π i traktuje polygon jako cały świat.
    const projection = geoMercator().fitSize([VIEW_W, VIEW_H], geo);
    return geoPath(projection);
  }, [geo]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + 14;
    const y = e.clientY - rect.top + 14;
    // Functional updater - bez tego stale closure z `tooltip` nadpisuje świeży
    // onMouseEnter starego elementu (race: mouseMove pali się przed renderem
    // po mouseEnter na nowym path).
    setTooltip((prev) => (prev ? { ...prev, x, y } : prev));
  };

  const renderContent = () => {
    const error = districtError ?? geoError;
    if (error) {
      return (
        <div className="flex aspect-[8/5] items-center justify-center px-4 text-center text-sm text-destructive">
          Nie udało się wczytać mapy: {error instanceof Error ? error.message : 'Nieznany błąd'}
        </div>
      );
    }
    if (districtLoading || geoLoading) {
      return <Skeleton className="aspect-[8/5] w-full rounded-lg" />;
    }
    if (!district || !geo || !pathBuilder) {
      return (
        <div className="flex aspect-[8/5] items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Brak mapy okręgu
        </div>
      );
    }

    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Mapa okręgu wyborczego nr ${district.number}`}
      >
        {geo.features.map((feature: Feature) => {
          const props = feature.properties as unknown as PowiatProps | GminaProps;
          const id = props.id;
          const count =
            level === 'powiaty' ? powiatCounts[id] ?? 0 : gminaCounts[id] ?? 0;
          const isSelected =
            level === 'powiaty' ? selectedPowiatId === id : selectedGminaId === id;
          const isHighlighted =
            id === (level === 'powiaty' ? district.highlighted_powiat_id : district.highlighted_gmina_id);
          const d = pathBuilder(feature) ?? '';

          return (
            <path
              key={id}
              d={d}
              fill={colorFor(count, isSelected)}
              stroke={isHighlighted ? HIGHLIGHT_STROKE : REGION_STROKE}
              strokeWidth={isHighlighted ? 1.5 : 0.75}
              className="cursor-pointer outline-none transition-opacity hover:opacity-80"
              onMouseEnter={() =>
                setTooltip((prev) => ({
                  name: props.name,
                  count,
                  isHighlighted,
                  x: prev?.x ?? 0,
                  y: prev?.y ?? 0,
                }))
              }
              onMouseLeave={() => setTooltip(null)}
              onClick={() => {
                if (level === 'powiaty') {
                  onChange({
                    powiatId: isSelected ? null : id,
                    gminaId: null,
                  });
                } else {
                  const gp = (props as GminaProps).powiat_id;
                  if (isSelected) {
                    onChange({ powiatId: gp, gminaId: null });
                  } else {
                    onChange({ powiatId: gp, gminaId: id });
                  }
                }
              }}
            >
              <title>
                {props.name} - {count} {plural(count)}
              </title>
            </path>
          );
        })}
      </svg>
    );
  };

  return (
    <section aria-label="Mapa okręgu" className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-2 border-b px-4 py-3 @sm:flex-row @sm:items-center @sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MapIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Mapa okręgu</h2>
            <p className="text-xs text-muted-foreground">
              Kliknij region, aby filtrować listę.
              {district?.highlight_label &&
                ` ${district.highlight_label} (czerwona ramka)${highlightedPowiat?.is_city ? ' - miasto na prawach powiatu' : ''}.`}
            </p>
          </div>
        </div>
        <div role="radiogroup" aria-label="Poziom mapy" className="inline-flex shrink-0 rounded-lg bg-muted p-0.5 max-md:gap-2">
          {(
            [
              ['powiaty', powiaty ? `Powiaty (${powiaty.length})` : 'Powiaty'],
              ['gminy', gminy ? `Gminy (${gminy.length})` : 'Gminy'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={level === value}
              onClick={() => setLevel(value)}
              className={cn(
                'h-7 rounded-md px-3 text-xs font-medium transition-colors max-md:h-10 max-md:px-4 max-md:text-[13px]',
                level === value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        <div ref={containerRef} className="relative mx-auto max-w-2xl" onMouseMove={handleMouseMove}>
          {renderContent()}

          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 max-w-[220px] rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <p className="font-medium">
                {tooltip.name}
                {tooltip.isHighlighted && <span className="ml-1 text-[10px] text-brand">★</span>}
              </p>
              <p className="text-muted-foreground">
                {tooltip.count} {plural(tooltip.count)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium">Liczba kontaktów:</span>
          {SCALE_BUCKETS.map((b) => (
            <span key={b.label} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full border border-border"
                style={{ backgroundColor: b.color }}
              />
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
