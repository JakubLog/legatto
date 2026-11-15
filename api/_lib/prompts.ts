// Prompty MCP (prompts/list, prompts/get) - gotowe procedury rozmowy zalezne od roli.
//
// Posel/Administrator: przeglad Pulsu Biura, decyzje w sprawie interpelacji, status zespolu.
// Pracownik: plan dnia wg obszarow odpowiedzialnosci, poprawki, raport tygodniowy.
// Prompt to tylko instrukcja dla modelu - dane pobiera on sam narzedziami (me_briefing,
// person_status, interpellations_* ...), wiec zakres danych i audyt pilnuja narzedzia.

import { POSEL_ROLES, type McpAuthContext, type McpRole } from './auth.js';
import { getSiteIdentity, mpForms, type MpForms } from './siteIdentity.js';

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  // Formy "Poseł"/"Posłanka" zależą od site_identity.mp_gender instancji.
  description: (forms: MpForms) => string;
  roles: readonly McpRole[];
  arguments?: PromptArgument[];
  build: (args: Record<string, string>, ctx: McpAuthContext, forms: MpForms) => string;
}

export class PromptArgumentError extends Error {}

const PRACOWNIK_ROLES = ['pracownik'] as const satisfies readonly McpRole[];

function roleLabel(role: McpRole, forms: MpForms): string {
  const labels: Record<McpRole, string> = {
    posel: forms.nominative,
    administrator: 'Administrator',
    pracownik: 'Pracownik',
  };
  return labels[role];
}

// Etykiety sygnalow Pulsu Biura - musza byc identyczne jak w aplikacji.
const SIGNAL_OK = '„Działania w normie”';
const SIGNAL_WARNING = '„W ostatnim czasie osłabienie działań”';
const SIGNAL_CRITICAL = '„Bardzo duży spadek działań”';

const MAX_ARG_LENGTH = 200;

function whoAmI(ctx: McpAuthContext, forms: MpForms): string {
  return `Rozmawiasz z: ${ctx.userFullName} (rola: ${roleLabel(ctx.userRole, forms)}).`;
}

const PRESENTATION =
  'Forma odpowiedzi: po polsku, zwięźle, nagłówki i krótkie listy lub tabele. ' +
  'Bez surowego JSON-a i identyfikatorów UUID, chyba że o nie poproszę. ' +
  'Niczego nie zmieniaj w systemie bez mojej wyraźnej zgody.';

const PROMPTS: PromptDefinition[] = [
  // --- Posel / Administrator -------------------------------------------------
  {
    name: 'poranny_przeglad',
    title: 'Poranny przegląd biura',
    description: (f) =>
      `Puls Biura (wynik i stan), obszary z sygnałami spadku i ich opiekunowie, decyzje czekające na ${f.accusative}, zaległości i 3 rekomendowane działania.`,
    roles: POSEL_ROLES,
    build: (_args, ctx, f) =>
      [
        'Przygotuj mój poranny przegląd biura.',
        whoAmI(ctx, f),
        '',
        'Kroki:',
        '1. Wywołaj me_briefing (days: 7). Inne narzędzia wywołuj tylko wtedy, gdy czegoś brakuje do punktów poniżej.',
        '2. Puls Biura: w jednym zdaniu podaj wynik (0-100) i stan biura (puls_biura.wynik, puls_biura.stan).',
        `3. Obszary: najpierw ${SIGNAL_CRITICAL}, potem ${SIGNAL_WARNING}. Przy każdym podaj opiekunów (imię i nazwisko) i powody z odpowiedzi (np. aktywność z ostatnich dni wobec średniej). Obszary ${SIGNAL_OK} wymień jednym zbiorczym zdaniem. Nazw sygnałów używaj dokładnie w tym brzmieniu.`,
        '4. Decyzje czekające na mnie: interpelacje w statusie „Nowa” i „Po poprawkach” (temat, adresat, od kiedy czekają, wersja). Jeśli są, zaproponuj prompt decyzje_do_podjecia albo przejście przez nie z interpellations_get i interpellations_decide.',
        '5. Zaległości: zaakceptowane interpelacje po terminie wysłania (deadline_at; wysyłkę potwierdza interpellations_mark_sent), przeterminowane sprawy (liczba i najważniejsze pozycje), najbliższe wydarzenia wymagające przygotowania.',
        '6. Zakończ sekcją „3 rekomendowane działania na dziś”: trzy konkretne kroki, każdy z obszarem lub osobą i sposobem wykonania (narzędzie, np. interpellations_decide, person_status dla opiekuna obszaru, events_create, budget_create, albo rozmowa z konkretną osobą). Wykorzystaj sugerowane_kroki z me_briefing, ale wybierz te o największym wpływie.',
        '',
        PRESENTATION,
      ].join('\n'),
  },
  {
    name: 'decyzje_do_podjecia',
    title: 'Decyzje do podjęcia',
    description: (f) =>
      `Interpelacje czekające na decyzję ${f.genitive} (Nowa, Po poprawkach): streszczenie każdej i sugerowana decyzja. Decyzja zapada dopiero po potwierdzeniu.`,
    roles: POSEL_ROLES,
    build: (_args, ctx, f) =>
      [
        'Pomóż mi podjąć decyzje w sprawie interpelacji, które czekają na mnie.',
        whoAmI(ctx, f),
        '',
        'Kroki:',
        '1. Wywołaj interpellations_list z status: "nowa", a potem z status: "po_poprawkach". Jeśli odpowiedź ma next_offset, pobierz kolejne strony.',
        '2. Jeśli obie listy są puste, napisz to wprost. Sprawdź wtedy interpellations_list z overdue_only: true i wymień zaakceptowane interpelacje po terminie wysłania.',
        '3. Dla każdej interpelacji wywołaj interpellations_get i przedstaw: temat, adresat, status, wersja, data złożenia, termin; streszczenie w 3-5 zdaniach (problem, pytania do adresata, oczekiwany efekt). Przy „Po poprawkach” pokaż moje poprzednie uwagi (review_notes) i oceń, czy zostały uwzględnione.',
        '4. Do każdej dodaj sugerowaną decyzję: zaakceptowana, uwagi albo odrzucona, z uzasadnieniem w 1-2 zdaniach. Przy „uwagi” zaproponuj gotową treść uwag dla Pracownika.',
        '5. Kolejność: od najdłużej czekających.',
        '6. Na końcu zapytaj, jakie decyzje podejmuję.',
        '',
        'Zasady:',
        '- NIGDY nie wywołuj interpellations_decide bez mojej wyraźnej zgody na konkretną decyzję dla konkretnej interpelacji. Nie decyduj hurtowo ani „domyślnie”.',
        '- Po zgodzie wywołaj interpellations_decide (id, decision; przy "uwagi" także notes) i potwierdź wynik.',
        '- Jeśli wolę sam poprawić treść zamiast odsyłać uwagi, przygotuj pełny poprawiony HTML (na bazie content_html z interpellations_get), pokaż mi zmienione fragmenty i po mojej zgodzie wywołaj interpellations_decide z decision: "zaakceptowana" i html (oraz subject/recipient, jeśli je zmieniam). Zapisze to nową wersję i od razu ją zaakceptuje.',
        '- Zaakceptowaną interpelację trzeba wysłać do terminu deadline_at. Faktyczną wysyłkę potwierdza interpellations_mark_sent - wywołuj je tylko, gdy potwierdzę, że interpelacja została wysłana.',
        '',
        PRESENTATION,
      ].join('\n'),
  },
  {
    name: 'status_zespolu',
    title: 'Status zespołu',
    description: () =>
      'Status opiekunów obszarów biura: obszary, sygnały i trend aktywności (tydzień, miesiąc, 8 tygodni) z oznaczeniem spadków. Opcjonalnie tylko jedna osoba.',
    roles: POSEL_ROLES,
    arguments: [
      {
        name: 'osoba',
        description: 'Imię i nazwisko albo id (UUID) osoby. Puste = wszyscy opiekunowie obszarów.',
        required: false,
      },
    ],
    build: (args, ctx, f) => {
      const osoba = args.osoba;
      const scope = osoba
        ? [
            `2. Interesuje mnie tylko osoba: "${osoba}". Jeśli to UUID, użyj go jako user_id. Jeśli to imię lub nazwisko, znajdź ją wśród opiekunów obszarów z me_briefing (a gdy jej tam nie ma, w users_list). Gdy pasuje kilka osób albo żadna, zapytaj mnie zamiast zgadywać.`,
            '3. Wywołaj person_status z user_id tej osoby.',
          ]
        : [
            '2. Zbierz listę opiekunów ze wszystkich obszarów (bez powtórzeń).',
            '3. Dla każdej osoby wywołaj person_status z jej user_id.',
          ];
      return [
        'Przygotuj status zespołu - osób odpowiedzialnych za obszary biura.',
        whoAmI(ctx, f),
        '',
        'Kroki:',
        '1. Wywołaj me_briefing, żeby poznać obszary, ich sygnały i opiekunów.',
        ...scope,
        '4. Dla każdej osoby pokaż nagłówek z imieniem i nazwiskiem oraz tabelę obszarów: Obszar | Sygnał | Powody.',
        '5. Pod nią tabela trendu aktywności: Miara | Ten tydzień | Poprzedni tydzień | Zmiana | Ten miesiąc | Poprzedni miesiąc | Zmiana. Dodaj jedno zdanie o serii z 8 tygodni (rośnie, stabilnie, spada).',
        `6. Wyraźnie oznacz spadki: obszary z sygnałem ${SIGNAL_WARNING} lub ${SIGNAL_CRITICAL} oraz miary, gdzie bieżący tydzień lub miesiąc jest wyraźnie niższy od poprzedniego (np. o 30% i więcej).`,
        '7. Na końcu maksymalnie 3 punkty: kto wymaga rozmowy lub wsparcia i dlaczego.',
        '',
        'Ton rzeczowy, nieoceniający: sygnały mierzą aktywność odnotowaną w systemie, a nie całą pracę danej osoby.',
        PRESENTATION,
      ].join('\n');
    },
  },

  // --- Pracownik -------------------------------------------------------------
  {
    name: 'moj_plan_na_dzis',
    title: 'Mój plan na dziś',
    description: () =>
      'Plan pracy na dziś uporządkowany według pilności: terminy, moje obszary odpowiedzialności z sygnałami spadku, potem pozostała otwarta praca.',
    roles: PRACOWNIK_ROLES,
    build: (_args, ctx, f) =>
      [
        'Ułóż mój plan pracy na dziś.',
        whoAmI(ctx, f),
        '',
        'Kroki:',
        '1. Wywołaj me_briefing (days: 7). Zawiera moje obszary odpowiedzialności z sygnałami, sugerowane działania, moje sprawy, terminy i interpelacje. Jeśli czegoś brakuje, uzupełnij przez me_agenda.',
        '2. Ułóż plan według pilności:',
        '   a) Terminy: przeterminowane sprawy, interpelacje w statusie „Uwagi” czekające na moje poprawki, dzisiejsze wydarzenia.',
        `   b) Moje obszary: najpierw ${SIGNAL_CRITICAL}, potem ${SIGNAL_WARNING}. Do każdego obszaru jedna konkretna czynność, która poprawi sygnał, np. Kalendarz - zaplanować spotkania (events_create); Interpelacje - przygotować i złożyć nową interpelację (interpellations_submit); Newsletter - przygotować i wysłać cotygodniowe wydanie; Widoczność w terenie - zaplanować wyjazd lub dyżur w terenie (events_create); Budżet biura - zebrać i uzupełnić wydatki (w MCP budget_create ma tylko ${f.nominative}, więc wprowadź je w aplikacji albo przekaż ${f.dative}).`,
        '   c) Pozostała otwarta praca: sprawy przypisane do mnie (cases_list z filtrem tylko moich, jeśli potrzebujesz więcej niż w me_briefing) i nadchodzące wydarzenia (events_list_upcoming).',
        '3. Format: lista numerowana; każdy punkt: co zrobić, dlaczego (termin albo sygnał), jakim narzędziem lub w którym module.',
        `4. Obszary ${SIGNAL_OK} wymień jednym zdaniem. Jeśli nie odpowiadam za żaden obszar, pomiń punkt b.`,
        '5. Na końcu przypomnij, że poza planem możesz wykonać dla mnie każde inne zadanie w ramach moich uprawnień (sprawy, kontakty, kalendarz, interpelacje) - wystarczy poprosić.',
        '',
        PRESENTATION,
      ].join('\n'),
  },
  {
    name: 'co_poprawic',
    title: 'Co poprawić',
    description: (f) =>
      `Interpelacje odesłane z uwagami ${f.genitive} (propozycje poprawek, ponowne złożenie po potwierdzeniu) oraz moje obszary z sygnałem spadku i sposób poprawy.`,
    roles: PRACOWNIK_ROLES,
    build: (_args, ctx, f) =>
      [
        'Pokaż, co powinienem poprawić.',
        whoAmI(ctx, f),
        '',
        'Część 1 - interpelacje z uwagami:',
        '1. Wywołaj interpellations_list z status: "uwagi" (jeśli jest next_offset, pobierz kolejne strony).',
        `2. Dla każdej wywołaj interpellations_get i pokaż: temat, adresat, wersja, uwagi ${f.genitive} (review_notes) dosłownie.`,
        '3. Do każdej uwagi zaproponuj konkretną poprawkę (co zmienić i jak brzmiałby poprawiony fragment).',
        '4. Poprawiony HTML składaj przez interpellations_resubmit dopiero po mojej wyraźnej zgodzie na konkretną wersję. Nigdy nie wysyłaj poprawek bez potwierdzenia.',
        '',
        'Część 2 - moje obszary:',
        `5. Wywołaj me_briefing i wybierz moje obszary z sygnałem ${SIGNAL_WARNING} lub ${SIGNAL_CRITICAL}.`,
        '6. Dla każdego podaj powody z odpowiedzi i 1-3 konkretne kroki, które poprawią sygnał, z narzędziem lub modułem, w którym je wykonam (np. events_create, interpellations_submit, cotygodniowe wydanie newslettera).',
        `7. Jeśli nie ma interpelacji z uwagami ani obszarów ze spadkiem, napisz to wprost (wszystko ${SIGNAL_OK}).`,
        '',
        PRESENTATION,
      ].join('\n'),
  },
  {
    name: 'raport_tygodniowy',
    title: 'Raport tygodniowy',
    description: (f) =>
      `Zwięzły raport tygodniowy dla ${f.genitive}: zrealizowane, w toku, problemy i ryzyka, plan na kolejny tydzień - na podstawie mojej aktywności, agendy i interpelacji.`,
    roles: PRACOWNIK_ROLES,
    build: (_args, ctx, f) =>
      [
        `Przygotuj mój raport tygodniowy dla ${f.genitive}.`,
        whoAmI(ctx, f),
        '',
        'Dane:',
        '1. Wywołaj person_status (bez user_id - moje dane): obszary, sygnały i trend aktywności tydzień do tygodnia.',
        '2. Wywołaj me_agenda (days: 7): otwarte sprawy, wydarzenia, niewysłane interpelacje.',
        '3. Wywołaj interpellations_list (active_only: true) i sprawdź etapy moich interpelacji; w razie potrzeby szczegóły przez interpellations_get.',
        '4. Jeśli potrzebujesz więcej szczegółów, użyj cases_list i events_list_upcoming.',
        '',
        'Struktura raportu (nagłówki dokładnie takie):',
        '- Zrealizowane: co udało się zrobić w tym tygodniu (sprawy zamknięte, wydarzenia, złożone lub poprawione interpelacje, liczby z person_status względem poprzedniego tygodnia).',
        `- W toku: otwarte sprawy i interpelacje z etapem i terminem.`,
        `- Problemy/ryzyka: przeterminowane sprawy, interpelacje blisko lub po terminie, obszary z sygnałem ${SIGNAL_WARNING} lub ${SIGNAL_CRITICAL} - z krótkim wyjaśnieniem.`,
        '- Plan na kolejny tydzień: 3-5 konkretnych punktów.',
        '',
        'Pisz po polsku, zwięźle (raport ma się zmieścić na jednym ekranie), bez UUID i surowych danych. Pokaż mi wersję roboczą do akceptacji.',
        '',
        'Informacyjnie (nie egzekwuj, tylko wspomnij na końcu jednym zdaniem): materiały z obszarów, za które odpowiadają inne osoby, uzgodnij z ich opiekunami (opiekunów obszarów podaje me_briefing).',
      ].join('\n'),
  },
];

const PROMPT_INDEX = new Map(PROMPTS.map((p) => [p.name, p]));

export async function listPrompts(ctx: McpAuthContext) {
  const forms = mpForms((await getSiteIdentity()).mp_gender);
  return PROMPTS.filter((p) => p.roles.includes(ctx.userRole)).map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description(forms),
    ...(p.arguments ? { arguments: p.arguments } : {}),
  }));
}

// Prompt niedostepny dla roli traktujemy jak nieistniejacy (nie ujawniamy listy innych rol).
export function findPrompt(name: string, ctx: McpAuthContext): PromptDefinition | undefined {
  const prompt = PROMPT_INDEX.get(name);
  return prompt?.roles.includes(ctx.userRole) ? prompt : undefined;
}

// Argumenty promptu wg MCP to mapa string -> string. Nieznane klucze odrzucamy,
// wartosci przycinamy i splaszczamy do jednej linii (trafiaja do tresci promptu).
export function parsePromptArgs(prompt: PromptDefinition, raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PromptArgumentError('Pole "arguments" musi byc obiektem.');
  }
  const allowed = new Set((prompt.arguments ?? []).map((a) => a.name));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new PromptArgumentError(`Prompt ${prompt.name} nie przyjmuje argumentu "${key}".`);
    }
    if (typeof value !== 'string') {
      throw new PromptArgumentError(`Argument "${key}" musi byc tekstem.`);
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length > MAX_ARG_LENGTH) {
      throw new PromptArgumentError(`Argument "${key}" moze miec maksymalnie ${MAX_ARG_LENGTH} znakow.`);
    }
    if (normalized) out[key] = normalized;
  }
  for (const arg of prompt.arguments ?? []) {
    if (arg.required && !out[arg.name]) {
      throw new PromptArgumentError(`Brak wymaganego argumentu "${arg.name}".`);
    }
  }
  return out;
}

export async function renderPrompt(prompt: PromptDefinition, args: Record<string, string>, ctx: McpAuthContext) {
  const forms = mpForms((await getSiteIdentity()).mp_gender);
  return {
    description: prompt.description(forms),
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.build(args, ctx, forms) } }],
  };
}
