// Healthcheck kontenera app bez powłoki i curl (obraz distroless):
//   node /app/server/healthcheck.mjs [ścieżka]   (domyślnie /livez)
// GET 127.0.0.1:INTERNAL_PORT<ścieżka>; kod 0 dla 2xx, 1 inaczej; limit 5 s.

import http from 'node:http';

const target = process.argv[2] ?? '/livez';
if (!/^\/[A-Za-z0-9._~/?=&-]{0,200}$/.test(target)) {
  console.error('healthcheck: niepoprawna ścieżka');
  process.exit(1);
}
const port = Number(process.env.INTERNAL_PORT ?? 3001);

const req = http.get({ host: '127.0.0.1', port, path: target, timeout: 5_000 }, (res) => {
  res.resume();
  const status = res.statusCode ?? 0;
  process.exit(status >= 200 && status < 300 ? 0 : 1);
});
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
req.on('error', () => process.exit(1));
