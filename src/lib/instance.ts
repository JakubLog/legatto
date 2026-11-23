// Flagi instancji (INSTANCE_AI, INSTANCE_MCP, INSTANCE_EMAIL, INSTANCE_PUSH, INSTANCE_GETRESPONSE,
// INSTANCE_ICS) z konfiguracji runtime (src/lib/runtime-config.ts), liczone tym samym parserem co
// serwer (api/_lib/instance.ts). Ukrywają UI; serwer egzekwuje te same flagi niezależnie.
import { RUNTIME_CONFIG } from '@/lib/runtime-config';

export const INSTANCE = RUNTIME_CONFIG.instance;
