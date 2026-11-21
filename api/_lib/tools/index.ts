import type { McpAuthContext, ToolChannel } from '../auth.js';
import { logAudit } from '../audit.js';
import { textResult, ToolValidationError, type ToolDefinition, type ToolResult } from './types.js';
import { meTools } from './me.js';
import { briefingTools } from './briefing.js';
import { casesTools } from './cases.js';
import { contactsTools } from './contacts.js';
import { eventsTools } from './events.js';
import { interpellationsTools } from './interpellations.js';
import { budgetTools } from './budget.js';
import { auditTools } from './audit.js';
import { dictionariesTools } from './dictionaries.js';
import { usersTools } from './users.js';
import { officesTools } from './offices.js';
import { settingsTools } from './settings.js';
import { icsTools } from './ics.js';

const ALL_TOOLS: ToolDefinition[] = [
  ...meTools,
  ...briefingTools,
  ...dictionariesTools,
  ...casesTools,
  ...contactsTools,
  ...eventsTools,
  ...interpellationsTools,
  ...budgetTools,
  ...auditTools,
  ...usersTools,
  ...officesTools,
  ...settingsTools,
  ...icsTools,
];

const TOOL_INDEX = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function isToolAllowed(tool: ToolDefinition, ctx: McpAuthContext): boolean {
  return !tool.roles || tool.roles.includes(ctx.userRole);
}

/**
 * Czy narzedzie istnieje w danym kanale (POLIAI_ONLY ukrywa administracje przed /api/mcp).
 * Kanal 'portal' nie wywoluje narzedzi (api/integracje.ts uzywa wspolnych funkcji) - zadne nie jest w nim widoczne.
 */
export function isToolExposed(tool: ToolDefinition, channel: ToolChannel): boolean {
  if (channel === 'portal') return false;
  return !tool.channels || tool.channels.includes(channel);
}

// MCP annotations (wskazowki dla klienta - claude.ai / Claude Code pytaja o zgode na zapis,
// mocniej przy destructiveHint). Klasy: odczyt (readOnly), zapis (nonDestructive), destrukcyjne
// (pozostale - usuwanie, decyzje bez odwrotu, skutki poza biurem). Potwierdzenia po stronie
// serwera (np. argument confirm) nie dodajemy: model pod wplywem prompt injection podalby go
// rownie latwo - realna bariera to zgoda czlowieka w kliencie i ograniczenie kanalow.
export function listTools(ctx: McpAuthContext) {
  return ALL_TOOLS.filter((t) => isToolExposed(t, ctx.channel) && isToolAllowed(t, ctx)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.readOnly === true,
      destructiveHint: t.readOnly !== true && t.nonDestructive !== true,
      idempotentHint: t.readOnly === true || t.idempotent === true,
      openWorldHint: t.openWorld === true,
    },
  }));
}

/** Narzedzie po nazwie, tylko jesli istnieje w kanale - ukryte zachowuje sie jak nieznane. */
export function getTool(name: string, channel: ToolChannel): ToolDefinition | undefined {
  const tool = TOOL_INDEX.get(name);
  return tool && isToolExposed(tool, channel) ? tool : undefined;
}

// Do audytu mcp.tool_call trafiaja identyfikatory rekordow (id, *_id) i fraza
// wyszukiwania (query, max 100 znakow) - zeby dalo sie ustalic, czyje dane odczytano.
// Pozostale wartosci argumentow (PII) nie sa logowane, tylko ich klucze.
function auditedArgs(args: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== 'id' && key !== 'query' && !key.endsWith('_id')) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 100);
  }
  return out;
}

/**
 * Wywolanie narzedzia wspolne dla /api/mcp i PoliAI: uprawnienia roli, audyt mcp.tool_call
 * (fail-closed - bez wpisu narzedzie sie nie wykona) i bledy jako ToolResult z isError,
 * zeby model widzial, co poszlo nie tak. Szczegoly bledow bazy tylko w logach serwera.
 */
export async function callTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: McpAuthContext,
): Promise<ToolResult> {
  if (!isToolExposed(tool, ctx.channel)) {
    return textResult(`Nieznane narzedzie: ${tool.name}`, true);
  }
  if (!isToolAllowed(tool, ctx)) {
    return textResult(`Narzedzie ${tool.name} wymaga uprawnien Posla.`, true);
  }
  try {
    const audited = await logAudit(ctx, 'mcp.tool_call', {
      metadata: { tool: tool.name, args_keys: Object.keys(args), args: auditedArgs(args) },
    });
    if (!audited) {
      return textResult('Nie udalo sie zapisac wpisu audytu - wywolanie narzedzia przerwane. Sprobuj ponownie.', true);
    }
    return await tool.handler(args, ctx);
  } catch (err) {
    if (err instanceof ToolValidationError) return textResult(`Blad walidacji: ${err.message}`, true);
    console.error(`[${ctx.channel}] tool error ${tool.name}:`, err);
    return textResult('Blad wykonania narzedzia (szczegoly w logach serwera).', true);
  }
}

export { ALL_TOOLS };
