/** Uruchomione jako zainstalowana aplikacja (PWA), nie w karcie przeglądarki. */
export function isStandalonePwa(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
