import { getServiceClient } from '../supabase.js';
import { DbError } from '../log-safe.js';
import { type ToolDefinition, jsonResult, optionalNumber, ToolValidationError } from './types.js';

async function listCategories(table: 'case_categories' | 'expense_categories') {
  const { data, error } = await getServiceClient().from(table).select('id, name').order('id');
  if (error) throw new DbError(error);
  return data ?? [];
}

export const dictionariesTools: ToolDefinition[] = [
  {
    name: 'case_categories_list',
    title: 'Kategorie spraw',
    readOnly: true,
    description:
      'Słownik kategorii spraw wyborców (id i nazwa). Użyj category_id przy tworzeniu, zmianie i filtrowaniu spraw - dobierz kategorię po nazwie, nie pytaj użytkownika o numer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => jsonResult({ categories: await listCategories('case_categories') }),
  },

  {
    name: 'expense_categories_list',
    title: 'Kategorie wydatków',
    readOnly: true,
    description:
      'Słownik kategorii wydatków biura (id i nazwa). Użyj category_id przy dodawaniu, zmianie i filtrowaniu wydatków.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => jsonResult({ categories: await listCategories('expense_categories') }),
  },

  {
    name: 'powiaty_list',
    title: 'Lista powiatów',
    readOnly: true,
    description:
      'Lista powiatów okręgu wyborczego z ich ID. Użyj powiat_id przy tworzeniu spraw, kontaktów i wydarzeń.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('powiaty')
        .select('id, name, is_city')
        .order('id');
      if (error) throw new DbError(error);
      return jsonResult({ powiaty: data ?? [] });
    },
  },

  {
    name: 'gminy_list',
    title: 'Lista gmin',
    readOnly: true,
    description:
      'Lista gmin w danym powiecie. Wymagane: powiat_id (z powiaty_list). Użyj gmina_id przy tworzeniu spraw i kontaktów.',
    inputSchema: {
      type: 'object',
      properties: {
        powiat_id: {
          type: 'integer',
          description: 'ID powiatu. Pobierz z powiaty_list.',
        },
      },
      required: ['powiat_id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const powiatId = optionalNumber(args, 'powiat_id');
      if (powiatId === null) throw new ToolValidationError('powiat_id wymagane');
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('gminy')
        .select('id, name, type')
        .eq('powiat_id', powiatId)
        .order('name');
      if (error) throw new DbError(error);
      return jsonResult({ powiat_id: powiatId, gminy: data ?? [] });
    },
  },
];
