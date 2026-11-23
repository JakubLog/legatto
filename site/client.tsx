import { hydrateRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@/index.css';
import { islandElement, ISLANDS, ISLANDS_SCRIPT_ID, newIslandQueryClient, type IslandRecord } from './islands';

// Wejście przeglądarki strony statycznej (build klienta -> site/dist/client/_app, CSS jak w SPA).
// Hydratuje wyspy z kontenerów [data-island]; bez PWA i service workera.

function readIslands(): IslandRecord[] {
  const script = document.getElementById(ISLANDS_SCRIPT_ID);
  if (!script?.textContent) return [];
  const parsed = JSON.parse(script.textContent) as unknown;
  return Array.isArray(parsed) ? (parsed as IslandRecord[]) : [];
}

const records = readIslands();
const queryClient = newIslandQueryClient();
for (const element of document.querySelectorAll<HTMLElement>('[data-island]')) {
  const record = records[Number(element.dataset.islandId)];
  if (!record || record.name !== element.dataset.island || !(record.name in ISLANDS)) continue;
  hydrateRoot(element, islandElement(record, queryClient));
}
