import { useMemo } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection } from 'geojson';
import type { SiteOffice } from '@/lib/siteSnapshot';
import { cn } from '@/lib/utils';
import { publicFocus, publicSkeleton } from '@/components/public/styles';

const VIEW_W = 600;
const PAD = 16;
/** Zapas nad mapą na etykiety pinezek miast leżących przy północnej granicy. */
const PAD_TOP = 48;

interface GminaProps {
  name: string;
  type: 'm' | 'w' | 'mw';
}

/** "Ełk (miasto)" -> "ełk"; nazwy gmin w GeoJSON rozróżniają miasto i gminę wiejską. */
const baseName = (name: string) => name.replace(/\s*\((miasto|gmina)\)$/i, '').trim().toLowerCase();

/** Granice okręgu (public/geo/okreg-<numer>-{powiaty,gminy}.geojson). */
export interface DistrictGeo {
  powiaty: FeatureCollection;
  gminy: FeatureCollection;
}

interface Props {
  offices: SiteOffice[];
  /** Granice okręgu; `undefined` - wczytywanie (szkielet), `null` - brak okręgu albo plików (bez mapy). */
  geo: DistrictGeo | null | undefined;
  /** Dostępna nazwa mapy (SVG <title>); dopisywana jest lista miast z biurami. */
  title: string;
  /** Podpis pod mapą; pusty = bez podpisu. */
  caption: string;
  className?: string;
}

/**
 * Mapa okręgu z pinezkami biur. Pozycja pinezki = środek gminy miejskiej (lub miejsko-wiejskiej)
 * o nazwie miasta biura; biuro w mieście spoza okręgu po prostu nie dostaje pinezki.
 * Granice podaje rodzic: SPA z useDistrictGeo (cache wspólny z mapami portalu), strona statyczna
 * z plików w buildzie (SVG renderowane SSR, bez JS). Instancja bez okręgu albo bez plików granic:
 * mapa znika, zostaje lista biur (strona publiczna nie pokazuje komunikatu).
 */
export function PublicOfficesMap({ offices, geo, title, caption, className }: Props) {
  const map = useMemo(() => {
    if (!geo) return null;
    const { powiaty, gminy } = geo;
    // Szerokość stała, wysokość wynika z kształtu okręgu; u góry zapas na etykiety pinezek.
    const projection = geoMercator().fitWidth(VIEW_W - 2 * PAD, powiaty);
    const [tx, ty] = projection.translate();
    projection.translate([tx + PAD, ty + PAD_TOP]);
    const path = geoPath(projection);
    const height = Math.ceil(path.bounds(powiaty)[1][1] + PAD);

    // Gmina miejska ma pierwszeństwo przed wiejską o tej samej nazwie (Ełk, Giżycko...).
    const centroids = new Map<string, [number, number]>();
    for (const feature of gminy.features) {
      const props = feature.properties as GminaProps;
      const key = baseName(props.name);
      if (props.type !== 'w' || !centroids.has(key)) centroids.set(key, path.centroid(feature));
    }

    const markers = offices.flatMap((office) => {
      const point = centroids.get(baseName(office.city));
      return point ? [{ office, x: point[0], y: point[1] }] : [];
    });
    // Biuro główne rysowane na końcu - zawsze na wierzchu.
    markers.sort((a, b) => Number(a.office.is_main) - Number(b.office.is_main));
    return { path, markers, height, powiaty, gminy };
  }, [geo, offices]);

  if (geo === null) return null;

  return (
    <figure className={cn('overflow-hidden rounded-[var(--public-radius-card)] border border-border bg-card', className)}>
      {map ? (
        <svg viewBox={`0 0 ${VIEW_W} ${map.height}`} className="block h-auto w-full" role="img" aria-labelledby="okreg-map-title">
          <title id="okreg-map-title">
            {title} - biura: {map.markers.map((m) => m.office.city).join(', ')}
          </title>
          <g aria-hidden>
            {map.gminy.features.map((feature: Feature, i) => (
              <path
                key={`g${i}`}
                d={map.path(feature) ?? undefined}
                fill="hsl(var(--cream-2))"
                stroke="hsl(var(--card))"
                strokeWidth={0.8}
              />
            ))}
            {map.powiaty.features.map((feature: Feature, i) => (
              <path
                key={`p${i}`}
                d={map.path(feature) ?? undefined}
                fill="none"
                stroke="hsl(var(--foreground) / 0.18)"
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
            ))}
          </g>

          {map.markers.map(({ office, x, y }) => {
            // Szerokość etykiety szacowana z długości nazwy (font 19, Poppins).
            const labelW = office.city.length * 12 + 28;
            const labelX = Math.min(Math.max(x - labelW / 2, 4), VIEW_W - labelW - 4);
            return (
              <a key={office.id} href={`#biuro-${office.id}`} className={cn('group', publicFocus)} aria-label={office.name}>
                <g transform={`translate(${labelX} ${y - 66})`}>
                  <rect
                    width={labelW}
                    height={34}
                    rx={8}
                    fill="hsl(var(--card))"
                    stroke="hsl(var(--border))"
                    className="transition-[fill] group-hover:fill-[hsl(var(--cream))]"
                  />
                  <text
                    x={labelW / 2}
                    y={23}
                    textAnchor="middle"
                    fontSize={19}
                    fontWeight={office.is_main ? 700 : 600}
                    fill="hsl(var(--foreground))"
                  >
                    {office.city}
                  </text>
                </g>
                {/* Pinezka: czubek dokładnie w punkcie miasta. */}
                <path
                  d={`M${x} ${y} l-7 -14 a8 8 0 1 1 14 0 z`}
                  fill="hsl(var(--brand))"
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                <circle cx={x} cy={y - 18} r={3} fill="hsl(var(--card))" />
              </a>
            );
          })}
        </svg>
      ) : (
        <div className={cn(publicSkeleton, 'aspect-[600/440] rounded-none')} aria-busy="true" aria-label="Ładowanie mapy" />
      )}
      {caption && (
        <figcaption className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground sm:px-5">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
