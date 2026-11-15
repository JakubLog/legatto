# Ikony PWA

Obecnie używamy SVG `icon.svg` jako placeholder. Przed produkcja **wygeneruj rastrowe PNG** (Android/iOS install screens preferują PNG):

- `icon-192.png` (192x192)
- `icon-512.png` (512x512)
- `icon-maskable-512.png` (512x512, z safe area 80%)
- `apple-touch-icon.png` (180x180, w `/public/`)

Polecane narzędzia: https://realfavicongenerator.net/ lub https://maskable.app/

Po dodaniu PNG zaktualizuj `vite.config.ts` - sekcja `manifest.icons`.
