// Mapa funkcji api/** → ścieżka URL, z semantyką systemu plików Vercela: `api/a/b.ts` → `/api/a/b`,
// segment `[nazwa]` → parametr w req.query. Lista plików jest statyczna (bundler wymaga statycznych
// importów w server/handlers.ts); server/routes.test.ts pilnuje, że pokrywa każdy plik api/**
// poza `_lib` - nowy endpoint bez wpisu tutaj nie zniknie po cichu na VPS.

export const API_FILES = [
  'api/cron/[job].ts',
  'api/integracje.ts',
  'api/mcp.ts',
  'api/newsletter-view.ts',
  'api/notifications.ts',
  'api/oauth/authorize.ts',
  'api/oauth/code.ts',
  'api/oauth/discovery.ts',
  'api/oauth/token.ts',
  'api/poliai.ts',
  'api/public-site.ts',
  'api/sejm-sittings.ts',
] as const;

export type ApiFile = (typeof API_FILES)[number];

export interface ApiRoute {
  file: ApiFile;
  regex: RegExp;
  params: string[];
  /** Trasy statyczne przed dynamicznymi (jak Vercel: dokładna nazwa pliku wygrywa z `[param]`). */
  dynamic: boolean;
}

const SEGMENT_PARAM_RE = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/;

export function apiRoute(file: ApiFile): ApiRoute {
  const segments = file.replace(/\.ts$/, '').split('/');
  const params: string[] = [];
  const pattern = segments
    .map((segment) => {
      const param = SEGMENT_PARAM_RE.exec(segment)?.[1];
      if (!param) return segment.replace(/[.+?^${}()|[\]\\-]/g, '\\$&');
      params.push(param);
      return '([^/]+)';
    })
    .join('/');
  return { file, regex: new RegExp(`^/${pattern}$`), params, dynamic: params.length > 0 };
}

export const API_ROUTES: readonly ApiRoute[] = API_FILES.map(apiRoute).sort((a, b) => Number(a.dynamic) - Number(b.dynamic));

export interface ApiMatch {
  route: ApiRoute;
  params: Record<string, string>;
}

export function matchApiRoute(pathname: string): ApiMatch | null {
  for (const route of API_ROUTES) {
    const m = route.regex.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.params.forEach((name, i) => {
      try {
        params[name] = decodeURIComponent(m[i + 1]);
      } catch {
        params[name] = m[i + 1];
      }
    });
    return { route, params };
  }
  return null;
}
