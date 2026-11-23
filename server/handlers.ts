// Statyczne importy handlerów api/** do bundla serwera (esbuild). Klucze = server/routes.ts API_FILES;
// brak wpisu albo nadmiarowy wpis to błąd typu (Record<ApiFile, …>).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import cronJob from '../api/cron/[job].js';
import integracje from '../api/integracje.js';
import mcp from '../api/mcp.js';
import newsletterView from '../api/newsletter-view.js';
import notifications from '../api/notifications.js';
import oauthAuthorize from '../api/oauth/authorize.js';
import oauthCode from '../api/oauth/code.js';
import oauthDiscovery from '../api/oauth/discovery.js';
import oauthToken from '../api/oauth/token.js';
import poliai from '../api/poliai.js';
import publicSite from '../api/public-site.js';
import sejmSittings from '../api/sejm-sittings.js';
import type { ApiFile } from './routes.js';

export type VercelHandler = (req: VercelRequest, res: VercelResponse) => unknown;

export const HANDLERS: Record<ApiFile, VercelHandler> = {
  'api/cron/[job].ts': cronJob,
  'api/integracje.ts': integracje,
  'api/mcp.ts': mcp,
  'api/newsletter-view.ts': newsletterView,
  'api/notifications.ts': notifications,
  'api/oauth/authorize.ts': oauthAuthorize,
  'api/oauth/code.ts': oauthCode,
  'api/oauth/discovery.ts': oauthDiscovery,
  'api/oauth/token.ts': oauthToken,
  'api/poliai.ts': poliai,
  'api/public-site.ts': publicSite,
  'api/sejm-sittings.ts': sejmSittings,
};
