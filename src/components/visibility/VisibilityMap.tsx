import { useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import type { Feature } from 'geojson';
import { MapPinned } from 'lucide-react';
import { VISIBILITY_HEX, VISIBILITY_LABELS, lastEventLabel, visibilityStatus } from '@/lib/visibility';
import { VisibilityMapSkeleton } from '@/components/visibility/VisibilityMapSkeleton';
import { VisibilityStatusPill } from '@/components/visibility/VisibilityStatusPill';
import { useDistrictConfig, useDistrictGeo } from '@/hooks/useDistrict';
import { usePowiatVisibility } from '@/hooks/usePowiatVisibility';

interface Props {
  thresholdDays: number;
}

interface PowiatGeoProps {
  id: number;
  name: string;
  teryt: string;
}

const VIEW_W = 800;
const VIEW_H = 500;
/** Musi odpowiadać `max-w-[240px]` dymka. */
const TOOLTIP_MAX_W = 240;

export function VisibilityMap({ thresholdDays }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<
    {
      name: string;
      status: string;
      events: number;
      contacts: number;
      lastEvent: string;
      x: number;
      y: number;
      flip: boolean;
    } | null
  >(null);

  const { data: district, isLoading: districtLoading, error: districtError } = useDistrictConfig();
  const { data: geo, isLoading: geoLoading, error: geoError } = useDistrictGeo(district?.number, 'powiaty');
  const error = districtError ?? geoError;
  const { data: stats = [], isLoading: statsLoading } = usePowiatVisibility();

  const statsById = useMemo(() => {
    const m = new Map<number, (typeof stats)[number]>();
    for (const s of stats) m.set(s.powiat_id, s);
    return m;
  }, [stats]);

  const pathBuilder = useMemo(() => {
    if (!geo) return null;
    return geoPath(geoMercator().fitSize([VIEW_W, VIEW_H], geo));
  }, [geo]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cardRight = containerRef.current.closest('section')?.getBoundingClientRect().right ?? rect.right;
    const cursorX = e.clientX - rect.left;
    // Dymek wychodzący poza kartę (np. wąski obszar modułu z otwartym PoliAI) trafia na lewo od kursora.
    const flip = e.clientX + 14 + TOOLTIP_MAX_W > cardRight;
    const x = flip ? rect.width - cursorX + 14 : cursorX + 14;
    const y = e.clientY - rect.top + 14;
    setTooltip((prev) => (prev ? { ...prev, x, y, flip } : prev));
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-4 py-12 text-center shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <MapPinned className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          Nie udało się wczytać mapy: {error instanceof Error ? error.message : 'Nieznany błąd'}
        </p>
      </div>
    );
  }

  if (districtLoading || geoLoading || statsLoading) {
    return <VisibilityMapSkeleton />;
  }

  if (!district || !geo || !pathBuilder) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-4 py-12 text-center shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MapPinned className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">Brak mapy okręgu</p>
      </div>
    );
  }

  return (
    <section aria-label="Mapa okręgu" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm max-md:p-3">
      <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Mapa okręgu</h2>
          <p className="text-xs text-muted-foreground">Kolor powiatu odpowiada statusowi obecności.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Legenda">
          <VisibilityStatusPill status="green" />
          <VisibilityStatusPill status="yellow" />
          <VisibilityStatusPill status="red" />
        </div>
      </div>

      <div ref={containerRef} className="relative mx-auto max-w-2xl" onMouseMove={handleMouseMove}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Mapa widoczności w terenie"
        >
          {geo.features.map((feature: Feature) => {
            const props = feature.properties as unknown as PowiatGeoProps;
            const id = props.id;
            const stat = statsById.get(id);
            const status = visibilityStatus(stat?.days_since_last_event ?? null, thresholdDays);
            const isHighlighted = id === district.highlighted_powiat_id;
            const d = pathBuilder(feature) ?? '';

            return (
              <path
                key={id}
                d={d}
                fill={VISIBILITY_HEX[status]}
                fillOpacity={0.75}
                stroke={isHighlighted ? 'hsl(var(--foreground))' : 'hsl(var(--card))'}
                strokeWidth={isHighlighted ? 1.5 : 0.75}
                className="cursor-pointer transition-opacity hover:opacity-90"
                onMouseEnter={() =>
                  setTooltip((prev) => ({
                    name: props.name,
                    status: VISIBILITY_LABELS[status],
                    events: stat?.events_count ?? 0,
                    contacts: stat?.contacts_count ?? 0,
                    lastEvent: lastEventLabel(stat?.last_event_at ?? null),
                    x: prev?.x ?? 0,
                    y: prev?.y ?? 0,
                    flip: prev?.flip ?? false,
                  }))
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <title>
                  {props.name} - {VISIBILITY_LABELS[status]}
                </title>
              </path>
            );
          })}
        </svg>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 max-w-[240px] space-y-0.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md max-md:hidden"
            style={tooltip.flip ? { right: tooltip.x, top: tooltip.y } : { left: tooltip.x, top: tooltip.y }}
          >
            <p className="font-medium">{tooltip.name}</p>
            <p className="text-muted-foreground">Status: {tooltip.status}</p>
            <p className="text-muted-foreground">Kontakty: {tooltip.contacts}</p>
            <p className="text-muted-foreground">Wydarzenia: {tooltip.events}</p>
            <p className="text-muted-foreground">Ostatnia obecność: {tooltip.lastEvent}</p>
          </div>
        )}
      </div>
    </section>
  );
}
