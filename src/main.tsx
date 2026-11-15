import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App';
import { initAccessibility } from './lib/accessibility';
import { isStandalonePwa } from './lib/pwa';
import './index.css';

// Zainstalowana aplikacja (PWA) startuje w panelu biura, nie na publicznej stronie.
// start_url w manifeście to już /biuro, ale iOS zapamiętuje start_url z chwili
// dodania do ekranu początkowego, więc starsze instalacje nadal otwierają "/".
// ?podglad = świadome otwarcie strony publicznej (np. z Admin > Strona główna).
if (isStandalonePwa() && window.location.pathname === '/' && !new URLSearchParams(window.location.search).has('podglad')) {
  window.history.replaceState(null, '', `/biuro${window.location.search}${window.location.hash}`);
}

initAccessibility();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
