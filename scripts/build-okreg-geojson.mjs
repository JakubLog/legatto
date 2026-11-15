// scripts/build-okreg-geojson.mjs
// Buduje mapę i słowniki okręgu wyborczego do Sejmu na podstawie definicji scripts/districts/<nr>.json.
// Wymaga plików źródłowych w geo-source/ (powiaty.json, gminy.json; katalog w .gitignore) - pobranych z:
//   https://github.com/waszkiewiczja/GeoJSON-Polska-Województwa-Powiaty-Gminy
//
// Tworzy dla okręgu <nr>:
//   public/geo/okreg-<nr>-powiaty.geojson     (properties: id, name, teryt) - runtime aplikacji
//   public/geo/okreg-<nr>-gminy.geojson       (properties: id, powiat_id, name, type, teryt)
//   scripts/districts/out/okreg-<nr>-seed.sql (słowniki powiaty/gminy + app_settings.district
//                                              dla NOWEJ instancji; nie migracja)
//
// Uruchomienie (geo-source/ lokalnie):
//   node scripts/build-okreg-geojson.mjs 35      (jeden okręg; pnpm build:geo 35)
//   node scripts/build-okreg-geojson.mjs --all   (wszystkie definicje z scripts/districts/ - kontrola)
// Pliki public/geo/ commituje się tylko dla okręgów działających instancji.
//
// Definicja okręgu (scripts/districts/<nr>.json):
//   number    - numer okręgu (1-41, Kodeks wyborczy zał. nr 1)
//   seat      - siedziba okręgowej komisji wyborczej (np. "Olsztyn")
//   powiaty   - lista powiatów okręgu: { teryt } (4 cyfry TERYT) i opcjonalnie id, name, is_city, lat, lng.
//               Brakujące pola są wyliczane z geo-source (id = kolejność, name z TERYT,
//               is_city = miasto na prawach powiatu, lat/lng = centroid).
//   gminy     - opcjonalna jawna lista gmin { id, powiat_id, raw, type: m|w|mw, display, db_name? };
//               brak = wszystkie gminy powiatów z geo-source w kolejności TERYT.
//               display = nazwa na mapie, db_name = nazwa w tabeli gminy (domyślnie display).
//   highlight - opcjonalnie { powiat_id, gmina_id, label } - region wyróżniony czerwoną ramką;
//               brak = gmina miejska siedziby (i jej powiat, gdy to miasto na prawach powiatu).
// Okręg 35 ma jawne listy (id zgodne z seedem migracji 20260425100000), wynik musi być
// bajtowo identyczny z plikami w public/geo/.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoCentroid } from 'd3-geo';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const districtsDir = resolve(__dirname, 'districts');
const sourcesDir = resolve(root, 'geo-source');
const geoOutDir = resolve(root, 'public/geo');
const sqlOutDir = resolve(districtsDir, 'out');

// ===== Helpers =====
// type: 'm' = miejska (kod TERYT kończy się na 1), 'w' = wiejska (...2), 'mw' = miejsko-wiejska (...3)
const TYPE_DIGIT = { m: '1', w: '2', mw: '3' };
const DIGIT_TYPE = { 1: 'm', 2: 'w', 3: 'mw' };
const DB_TYPE = { m: 'miejska', w: 'wiejska', mw: 'miejsko-wiejska' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Klasyczny shoelace (Gauss area formula). W układzie geographic (lon=x, lat=y z lat rosnącym w gore):
//   sum > 0 → ring jest CCW (counter-clockwise)
//   sum < 0 → ring jest CW (clockwise)
function isRingCCW(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum > 0;
}

// Naprawia winding order pod d3-geo 3.x: outer ring = CW, holes = CCW.
// (D3-geo wersja 3.1.1 oczekuje odwrotności RFC 7946 - sprawdzone empirycznie:
// dla outer=CCW geoArea zwraca 4π (cała sfera) zamiast małej wartości.)
// Bez tego rewind d3-geo traktuje polygon jako "cały świat oprócz dziury"
// i geoMercator/geoBounds dają totalnie zle bbox.
function rewindGeometry(geom) {
  const fix = (rings) =>
    rings.map((ring, i) => {
      const ccw = isRingCCW(ring);
      const wantCCW = i !== 0; // outer = CW, holes = CCW
      return ccw === wantCCW ? ring : ring.slice().reverse();
    });

  if (geom.type === 'Polygon') {
    return { ...geom, coordinates: fix(geom.coordinates) };
  }
  if (geom.type === 'MultiPolygon') {
    return { ...geom, coordinates: geom.coordinates.map((poly) => fix(poly)) };
  }
  return geom;
}

function findGminaFeature(features, powiatTeryt, gmina) {
  const targetType = TYPE_DIGIT[gmina.type];
  // Filtr po prefixie kodu powiatu
  const candidates = features.filter((f) => f.properties.JPT_KOD_JE.startsWith(powiatTeryt));
  // Najpierw po dokładnej nazwie + typie
  let found = candidates.find((f) => {
    const code = f.properties.JPT_KOD_JE;
    const typeDigit = code[code.length - 1];
    return f.properties.JPT_NAZWA_ === gmina.raw && typeDigit === targetType;
  });
  if (found) return found;

  // Fallback: po samej nazwie (gdy w GeoJSON występuje tylko jeden wariant)
  found = candidates.find((f) => f.properties.JPT_NAZWA_ === gmina.raw);
  return found ?? null;
}

// "powiat olsztyński" -> "olsztyński", "powiat Olsztyn" -> "m. Olsztyn" (konwencja tabeli powiaty).
function powiatDisplayName(rawName, isCity) {
  const base = rawName.replace(/^powiat\s+/, '');
  return isCity ? `m. ${base}` : base;
}

// Kody 61-99 na pozycjach 3-4 TERYT = miasto na prawach powiatu.
const isCityTeryt = (teryt) => Number(teryt.slice(2, 4)) >= 61;

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** Uzupełnia definicję okręgu brakującymi polami z geo-source; zwraca komplet danych. */
function resolveDistrict(def, powiatySrc, gminySrc) {
  if (!Number.isInteger(def.number) || def.number < 1 || def.number > 41) {
    fail(`Niepoprawny numer okręgu: ${def.number}`);
  }
  if (!Array.isArray(def.powiaty) || def.powiaty.length === 0) fail(`Okręg ${def.number}: brak listy powiatów`);

  const powiaty = def.powiaty.map((p, i) => {
    const feature = powiatySrc.features.find((f) => f.properties.JPT_KOD_JE === p.teryt);
    if (!feature) fail(`BRAK powiatu: okręg ${def.number}, TERYT ${p.teryt}`);
    const geometry = rewindGeometry(feature.geometry);
    const isCity = p.is_city ?? isCityTeryt(p.teryt);
    const [lng, lat] = p.lat != null && p.lng != null ? [p.lng, p.lat] : geoCentroid(geometry);
    return {
      id: p.id ?? i + 1,
      teryt: p.teryt,
      name: p.name ?? powiatDisplayName(feature.properties.JPT_NAZWA_, isCity),
      is_city: isCity,
      lat: round5(lat),
      lng: round5(lng),
      geometry,
    };
  });

  let gminy;
  if (Array.isArray(def.gminy)) {
    const missing = [];
    gminy = [];
    for (const g of def.gminy) {
      const powiat = powiaty.find((p) => p.id === g.powiat_id);
      if (!powiat) fail(`Okręg ${def.number}: gmina id=${g.id} wskazuje nieznany powiat ${g.powiat_id}`);
      const f = findGminaFeature(gminySrc.features, powiat.teryt, g);
      if (!f) {
        missing.push(`id=${g.id} ${g.display} (powiat ${powiat.name})`);
        continue;
      }
      gminy.push({
        id: g.id,
        powiat_id: g.powiat_id,
        display: g.display,
        db_name: g.db_name ?? g.display,
        type: g.type,
        teryt: f.properties.JPT_KOD_JE,
        geometry: rewindGeometry(f.geometry),
      });
    }
    if (missing.length > 0) {
      console.warn(`UWAGA - nie znaleziono ${missing.length} gmin:`);
      missing.forEach((m) => console.warn('  ' + m));
    }
  } else {
    // Wszystkie gminy powiatów okręgu (miejskie, wiejskie, miejsko-wiejskie) w kolejności TERYT.
    const rows = [];
    for (const powiat of powiaty) {
      gminySrc.features
        .filter((f) => f.properties.JPT_KOD_JE.startsWith(powiat.teryt) && DIGIT_TYPE[f.properties.JPT_KOD_JE.at(-1)])
        .sort((a, b) => a.properties.JPT_KOD_JE.localeCompare(b.properties.JPT_KOD_JE))
        .forEach((f) => rows.push({ powiat, f }));
    }
    const namesIn = (powiatId) =>
      rows.filter((r) => r.powiat.id === powiatId).map((r) => r.f.properties.JPT_NAZWA_);
    gminy = rows.map(({ powiat, f }, i) => {
      const raw = f.properties.JPT_NAZWA_;
      const type = DIGIT_TYPE[f.properties.JPT_KOD_JE.at(-1)];
      // Miasto i gmina wiejska o tej samej nazwie w jednym powiecie: "Ełk (miasto)" / "Ełk (gmina)".
      const twinInPowiat = namesIn(powiat.id).filter((n) => n === raw).length > 1;
      const dbName = twinInPowiat ? `${raw} (${type === 'w' ? 'gmina' : 'miasto'})` : raw;
      // Ta sama nazwa w innym powiecie okręgu (np. miasto na prawach powiatu i gmina wiejska
      // w powiecie ziemskim): na mapie "Elbląg (miasto)" / "Elbląg (gmina)"; dwie gminy tego
      // samego typu dostają nazwę powiatu, np. "Świętajno (olecki)".
      const twins = rows.filter((r) => r.powiat.id !== powiat.id && r.f.properties.JPT_NAZWA_ === raw);
      let display = dbName;
      if (!twinInPowiat && twins.length > 0) {
        const sameType = twins.every((r) => DIGIT_TYPE[r.f.properties.JPT_KOD_JE.at(-1)] === type);
        if (sameType) display = `${raw} (${powiat.name})`;
        else if (type === 'w') display = `${raw} (gmina)`;
        else if (type === 'm') display = `${raw} (miasto)`;
      }
      return {
        id: i + 1,
        powiat_id: powiat.id,
        display,
        db_name: dbName,
        type,
        teryt: f.properties.JPT_KOD_JE,
        geometry: rewindGeometry(f.geometry),
      };
    });
  }

  let highlight = def.highlight;
  if (!highlight) {
    const seatGmina =
      gminy.find((g) => g.type === 'm' && g.db_name.replace(/ \(miasto\)$/, '') === def.seat) ??
      gminy.find((g) => g.type === 'mw' && g.db_name === def.seat);
    if (!seatGmina) {
      console.warn(`Info - okręg ${def.number}: siedziba OKW "${def.seat}" leży poza okręgiem, mapa bez wyróżnienia`);
    }
    const seatPowiat = seatGmina ? powiaty.find((p) => p.id === seatGmina.powiat_id) : null;
    highlight = {
      powiat_id: seatPowiat?.is_city ? seatPowiat.id : null,
      gmina_id: seatGmina?.id ?? null,
      label: seatGmina ? def.seat : '',
    };
  }

  return { number: def.number, seat: def.seat ?? '', powiaty, gminy, highlight };
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Seed słowników okręgu dla nowej instancji (zastępuje powiaty/gminy okręgu 35 z migracji init). */
function buildSeedSql(d) {
  const settings = {
    number: d.number,
    highlighted_powiat_id: d.highlight.powiat_id ?? null,
    highlighted_gmina_id: d.highlight.gmina_id ?? null,
    highlight_label: d.highlight.label ?? '',
  };
  const powiatyRows = d.powiaty
    .map((p) => `  (${p.id}, ${sqlText(p.name)}, ${p.is_city}, ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`)
    .join(',\n');
  const gminyRows = d.gminy
    .map((g) => `  (${g.id}, ${g.powiat_id}, ${sqlText(g.db_name)}, ${sqlText(DB_TYPE[g.type])})`)
    .join(',\n');

  return `-- Słowniki okręgu wyborczego nr ${d.number} (${d.seat}) - wygenerowane przez
--   node scripts/build-okreg-geojson.mjs ${d.number}
-- NIE migracja: jednorazowy skrypt danych NOWEJ instancji, uruchamiany po wszystkich migracjach.
-- Migracja 20260425100000 seeduje słowniki okręgu 35 w każdej instancji; ten skrypt je zastępuje
-- i ustawia app_settings.district (mapy w aplikacji: public/geo/okreg-${d.number}-*.geojson).
--
-- Uruchomienie (z katalogu repo, projekt Supabase nowej instancji podlinkowany):
--   supabase db query --linked -f scripts/districts/out/okreg-${d.number}-seed.sql
--
-- Odmawia działania, gdy instancja ma już kontakty, sprawy, wydarzenia lub zgłoszenia publiczne
-- (wskazują powiaty/gminy po id).

begin;

do $$
begin
  if exists (select 1 from public.contacts)
     or exists (select 1 from public.cases)
     or exists (select 1 from public.events)
     or exists (select 1 from public.public_submissions) then
    raise exception 'Instancja ma już dane powiązane z powiatami/gminami - słowniki okręgu podmienia się tylko na pustej instancji';
  end if;
end $$;

delete from public.gminy;
delete from public.powiaty;

insert into public.powiaty (id, name, is_city, lat, lng) values
${powiatyRows};

insert into public.gminy (id, powiat_id, name, type) overriding system value values
${gminyRows};

select setval(pg_get_serial_sequence('public.gminy', 'id'), (select max(id) from public.gminy));

insert into public.app_settings (key, value)
values ('district', ${sqlText(JSON.stringify(settings))}::jsonb)
on conflict (key) do update set value = excluded.value;

commit;
`;
}

// ===== Main =====
const USAGE = 'Użycie: node scripts/build-okreg-geojson.mjs <numer okręgu...> | --all';
const requested = process.argv.slice(2);
if (requested.length === 0) fail(USAGE);
const numbers = requested.includes('--all')
  ? readdirSync(districtsDir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => Number(f.replace('.json', '')))
      .sort((a, b) => a - b)
  : requested.map((a) => {
      const n = Number(a);
      if (!Number.isInteger(n)) fail(`${USAGE} (podano "${a}")`);
      return n;
    });

const powiatySrc = JSON.parse(readFileSync(resolve(sourcesDir, 'powiaty.json'), 'utf8'));
const gminySrc = JSON.parse(readFileSync(resolve(sourcesDir, 'gminy.json'), 'utf8'));
mkdirSync(geoOutDir, { recursive: true });
mkdirSync(sqlOutDir, { recursive: true });

for (const number of numbers) {
  let def;
  try {
    def = JSON.parse(readFileSync(resolve(districtsDir, `${number}.json`), 'utf8'));
  } catch (e) {
    fail(`Brak lub błędna definicja scripts/districts/${number}.json: ${e.message}`);
  }
  if (def.number !== number) fail(`scripts/districts/${number}.json ma number=${def.number}`);
  const d = resolveDistrict(def, powiatySrc, gminySrc);

  // --- Powiaty ---
  const powiatyOut = {
    type: 'FeatureCollection',
    features: d.powiaty.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, name: p.name, teryt: p.teryt },
      geometry: p.geometry,
    })),
  };
  writeFileSync(resolve(geoOutDir, `okreg-${number}-powiaty.geojson`), JSON.stringify(powiatyOut));

  // --- Gminy ---
  const gminyOut = {
    type: 'FeatureCollection',
    features: d.gminy.map((g) => ({
      type: 'Feature',
      properties: { id: g.id, powiat_id: g.powiat_id, name: g.display, type: g.type, teryt: g.teryt },
      geometry: g.geometry,
    })),
  };
  writeFileSync(resolve(geoOutDir, `okreg-${number}-gminy.geojson`), JSON.stringify(gminyOut));

  // --- Seed SQL ---
  writeFileSync(resolve(sqlOutDir, `okreg-${number}-seed.sql`), buildSeedSql(d));

  const sizeP = (JSON.stringify(powiatyOut).length / 1024).toFixed(1);
  const sizeG = (JSON.stringify(gminyOut).length / 1024).toFixed(1);
  console.log(
    `OK: okręg ${number} (${d.seat}) - powiaty ${d.powiaty.length}, gminy ${d.gminy.length}` +
      ` (${sizeP} KB / ${sizeG} KB), wyróżnienie: ${d.highlight.label || 'brak'}`,
  );
}
