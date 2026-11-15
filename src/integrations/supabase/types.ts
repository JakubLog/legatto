// Bazowe typy dla schematu public - w przyszlosci wygenerujemy z Supabase CLI:
//   pnpm dlx supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts

export type AppRole = 'posel' | 'administrator' | 'pracownik' | 'asystent';

export type DataScope = 'own' | 'all';

export interface Office {
  id: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_main: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  office_id: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_public: boolean;
  password_set: boolean;
  has_privacy_pin: boolean;
  scope_contacts: DataScope;
  scope_cases: DataScope;
  scope_events: DataScope;
  scope_interpellations: DataScope;
  created_at: string;
  updated_at: string;
}

// get_all_users_admin nie zwraca statusu PIN-u trybu prywatnego.
export interface ProfileWithOffice extends Omit<Profile, 'has_privacy_pin'> {
  office: Pick<Office, 'id' | 'name' | 'city'> | null;
  last_sign_in_at: string | null;
}

export interface PublicStaffMember {
  id: string;
  full_name: string;
  role: AppRole;
  phone: string | null;
  avatar_url: string | null;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ===== Faza 2: Kontakty =====

export type ContactType = 'wyborca' | 'dziennikarz' | 'samorządowiec' | 'sołtys' | 'inne';

export type GminaType = 'miejska' | 'wiejska' | 'miejsko-wiejska';

export interface Powiat {
  id: number;
  name: string;
  is_city: boolean;
  lat: number;
  lng: number;
}

export interface Gmina {
  id: number;
  powiat_id: number;
  name: string;
  type: GminaType;
}

export interface Contact {
  id: string;
  type: ContactType;
  first_name: string;
  last_name: string;
  function: string | null;
  phone: string | null;
  email: string | null;
  powiat_id: number;
  gmina_id: number | null;
  miejscowosc: string | null;
  street: string | null;
  postal_code: string | null;
  notes: string | null;
  tags: string[];
  newsletter_consent: boolean;
  gr_contact_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactWithRelations extends Contact {
  powiat: Pick<Powiat, 'id' | 'name'> | null;
  gmina: Pick<Gmina, 'id' | 'name'> | null;
  creator: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

// ===== Faza 3: Sprawy =====

export type CaseStatus = 'nowa' | 'w_toku' | 'oczekuje' | 'załatwiona' | 'odrzucona';
export type CasePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CaseCategory {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
}

export type CaseSource = 'internal' | 'public_form';

export interface Case {
  id: string;
  title: string;
  description: string | null;
  status: CaseStatus;
  priority: CasePriority;
  category_id: number | null;
  contact_id: string | null;
  reporter_name: string | null;
  reporter_phone: string | null;
  reporter_email: string | null;
  powiat_id: number | null;
  gmina_id: number | null;
  assigned_to: string | null;
  due_date: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  source: CaseSource;
  consent_newsletter: boolean;
  consent_contacts_db: boolean;
  submission_ip_hash: string | null;
  submission_user_agent: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseWithRelations extends Case {
  category: Pick<CaseCategory, 'id' | 'name' | 'color'> | null;
  contact: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'phone' | 'email'> | null;
  powiat: Pick<Powiat, 'id' | 'name'> | null;
  gmina: Pick<Gmina, 'id' | 'name'> | null;
  assigned: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
  creator: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

// Historia sprawy (migracja 20261111300000_case_history.sql): wpisy zapisują wyłącznie triggery.
export type CaseActivityKind =
  | 'created'
  | 'status'
  | 'assigned'
  | 'priority'
  | 'due_date'
  | 'category'
  | 'title'
  | 'description'
  | 'attachment_added'
  | 'attachment_removed';

export interface CaseActivity {
  id: string;
  case_id: string;
  kind: CaseActivityKind;
  /** from/to (+ from_name/to_name przy assigned/category), source przy created, filename przy załącznikach. */
  data: Record<string, string | null | undefined>;
  actor_id: string | null;
  created_at: string;
  actor: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

export interface CaseComment {
  id: string;
  case_id: string;
  author_id: string | null;
  body: string;
  /** Oczyszczone w DB: bez duplikatów, bez autora, tylko aktywne osoby widzące sprawę. */
  mentions: string[];
  created_at: string;
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

// ===== Faza 4: Kalendarz =====

export type EventType = 'spotkanie' | 'wyjazd' | 'media' | 'inne';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  type: EventType;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  powiat_id: number | null;
  gmina_id: number | null;
  case_id: string | null;
  contact_id: string | null;
  assigned_to: string | null;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicCalendarEvent {
  id: string;
  title: string;
  description: string | null;
  type: EventType;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  powiat_name: string | null;
  gmina_name: string | null;
}

export interface CalendarEventWithRelations extends CalendarEvent {
  case: Pick<Case, 'id' | 'title' | 'status'> | null;
  contact: Pick<Contact, 'id' | 'first_name' | 'last_name'> | null;
  powiat: Pick<Powiat, 'id' | 'name'> | null;
  gmina: Pick<Gmina, 'id' | 'name'> | null;
  assigned: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

// ===== Faza 5: Widocznosc w terenie =====

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  updated_by: string | null;
  updated_at: string;
}

export interface PowiatVisibilityStats {
  powiat_id: number;
  powiat_name: string;
  is_city: boolean;
  lat: number;
  lng: number;
  contacts_count: number;
  events_count: number;
  last_event_at: string | null;
  days_since_last_event: number | null;
}

// ===== Interpelacje: obieg pracownik (MCP) -> decyzja Posła -> wysyłka =====

export type InterpellationStatus =
  | 'nowa'
  | 'uwagi'
  | 'po_poprawkach'
  | 'zaakceptowana'
  | 'wyslana'
  | 'odrzucona';

/** Decyzja Posła nad interpelacją w statusie `nowa` lub `po_poprawkach`. */
export type InterpellationDecision = 'zaakceptowana' | 'uwagi' | 'odrzucona';

export interface Interpellation {
  id: string;
  recipient: string;
  subject: string;
  /** Oryginalny HTML wgrany przez MCP; wyświetlany wyłącznie w sandboxowanym iframe. */
  content_html: string;
  /** Tekst wyekstrahowany z HTML przy wgraniu (do kopiowania i wyszukiwania). */
  content_text: string;
  /** Uwagi Posła z ostatniej decyzji (wymagane przy `uwagi`, opcjonalne przy pozostałych). */
  review_notes: string | null;
  /** Numer wersji treści; +1 przy każdym wgraniu poprawek. */
  revision: number;
  case_id: string | null;
  signatory_id: string;
  status: InterpellationStatus;
  /** Moment ostatniego wgrania treści (pierwsze wgranie albo poprawki). */
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  accepted_at: string | null;
  /** Termin wysłania: accepted_at + 1 dzień. */
  deadline_at: string | null;
  sent_at: string | null;
  /** Moment odrzucenia (trafienia do archiwum). */
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Wiersz listy: bez ciężkich pól treści. */
export type InterpellationListItem = Omit<Interpellation, 'content_html' | 'content_text'> & {
  case: Pick<Case, 'id' | 'title'> | null;
  creator: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
};

export interface InterpellationWithRelations extends Interpellation {
  case: Pick<Case, 'id' | 'title'> | null;
  creator: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
  signatory: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'role'> | null;
  decider: Pick<Profile, 'id' | 'full_name'> | null;
}

// ===== Faza 8: Budzet biura =====

export type PaymentMethod = 'przelew' | 'karta' | 'gotowka' | 'inne';

export interface ExpenseCategory {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  is_system: boolean;
  /** Pozycja sprawozdania z wydatkowania ryczałtu (`SettlementItemCode`); null = nieprzypisana. */
  settlement_item: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OfficeExpense {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  category_id: number | null;
  expense_date: string;
  vendor: string | null;
  invoice_number: string | null;
  payment_method: PaymentMethod | null;
  receipt_path: string | null;
  receipt_mime: string | null;
  notes: string | null;
  /** Brak pliku faktury/paragonu (`receipt_path is null`); kolumna generowana w bazie, tylko odczyt. */
  missing_invoice_file: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfficeExpenseWithRelations extends OfficeExpense {
  category: Pick<ExpenseCategory, 'id' | 'name' | 'color'> | null;
  creator: Pick<Profile, 'id' | 'full_name'> | null;
}

// ===== Analityka budżetu i raporty AI (ai-lib/plans/2026-10-26-budzet-analityka-raporty-ai.md) =====

/** Suma wydatków w miesiącu historii (miesiące bez wydatków = 0). */
export interface BudgetMonthTotal {
  month: string;
  total: number;
  count: number;
}

export interface BudgetCategoryStat {
  /** null = wydatki bez kategorii ("Bez kategorii"). */
  id: number | null;
  name: string;
  color: string | null;
  current: number;
  previous: number;
  /** Średnia z 3 miesięcy przed wybranym (miesiące bez wydatków liczone jako 0). */
  avg3: number;
  /** Liczba wydatków w wybranym miesiącu. */
  count: number;
}

export interface BudgetVendorStat {
  vendor: string;
  current: number;
  previous: number;
  count: number;
}

/** Kontrahent obecny w >= 3 z 6 ostatnich miesięcy (do wybranego włącznie) - koszt stały / abonament. */
export interface BudgetRecurringCost {
  vendor: string;
  category: string | null;
  months_present: number;
  /** Średnia miesięczna suma w miesiącach, w których kontrahent wystąpił. */
  avg_amount: number;
  /** Suma w ostatnim miesiącu wystąpienia. */
  last_amount: number;
  last_date: string;
  in_current: boolean;
}

/** Wydatek wybranego miesiąca >= 2x mediany swojej kategorii z 6 poprzednich miesięcy. */
export interface BudgetAnomaly {
  id: string;
  title: string;
  amount: number;
  expense_date: string;
  category: string | null;
  vendor: string | null;
  median: number;
  ratio: number;
}

/** Para wydatków o tej samej kwocie i kontrahencie (albo tytule) w odstępie <= 7 dni. */
export interface BudgetDuplicate {
  ids: [string, string];
  title: string;
  vendor: string | null;
  amount: number;
  dates: [string, string];
}

/** Opłaty, prowizje, odsetki, kary, abonamenty (słowa kluczowe w tytule/opisie/notatkach). */
export interface BudgetFeeExpense {
  id: string;
  title: string;
  amount: number;
  expense_date: string;
  vendor: string | null;
}

/** Wynik `get_budget_analytics(p_month)` / `service_budget_analytics(p_month)`. */
export interface BudgetAnalytics {
  month: string;
  /** Dzisiejsza data (Europe/Warsaw), YYYY-MM-DD. */
  as_of: string;
  /** 12 miesięcy rosnąco; ostatni = `month`. */
  months: BudgetMonthTotal[];
  /** Wybrany miesiąc do dzisiaj (bieżący: bez wydatków z datą przyszłą); dla zamkniętego = cała suma. */
  current_to_date: number;
  /** Poprzedni miesiąc do tego samego dnia (dla bieżącego miesiąca); dla zamkniętego = cały poprzedni. */
  previous_to_date: number;
  pace: { days_in_month: number; days_elapsed: number };
  ytd: { year: string; total: number; prev_year_same_period: number };
  categories: BudgetCategoryStat[];
  vendors: BudgetVendorStat[];
  recurring: BudgetRecurringCost[];
  anomalies: BudgetAnomaly[];
  duplicates: BudgetDuplicate[];
  fees: BudgetFeeExpense[];
  /** Wydatki < 100 zł w wybranym miesiącu. */
  small_expenses: { count: number; total: number };
  payment_methods: { method: PaymentMethod | null; total: number; count: number }[];
  data_quality: {
    total_count: number;
    no_receipt_count: number;
    no_receipt_sum: number;
    no_category_count: number;
    no_vendor_count: number;
    no_invoice_count: number;
  };
  /**
   * Miesięczny limit (zł) z chwili generowania raportu - tylko w migawce `budget_reports.analytics`
   * (dopisuje /api/poliai?op=budget-report od 2026-11). RPC analityki tego pola nie zwraca.
   */
  monthly_limit_pln?: number;
}

export type BudgetReportSeverity = 'info' | 'warning' | 'critical';
export type BudgetReportTrend = 'up' | 'down' | 'flat';

/** Treść raportu AI (structured outputs, schemat i walidacja zod w api/_lib/poliai/budget-report.ts). */
export interface BudgetReportContent {
  headline: string;
  /** Markdown, 2-4 akapity. */
  summary: string;
  comparisons: { title: string; detail: string; trend: BudgetReportTrend }[];
  insights: { title: string; detail: string; severity: BudgetReportSeverity; expense_ids: string[] }[];
  hidden_costs: { title: string; detail: string; estimated_monthly_pln: number | null; expense_ids: string[] }[];
  recommendations: { title: string; detail: string; potential_saving_pln: number | null }[];
  forecast: string;
}

/** Wiersz `budget_reports`. */
export interface BudgetReport {
  id: string;
  /** YYYY-MM */
  period: string;
  content: BudgetReportContent;
  /** Dane wejściowe raportu (migawka z chwili generowania). */
  analytics: BudgetAnalytics;
  model: string;
  created_by: string | null;
  created_at: string;
}

export interface BudgetReportWithCreator extends BudgetReport {
  creator: Pick<Profile, 'id' | 'full_name'> | null;
}

/** Suma roku dla jednej kategorii (`category_id` null = wydatki bez kategorii). */
export interface BudgetYearCategoryTotal {
  category_id: number | null;
  total: number;
  count: number;
  missing_invoice_count: number;
}

/** Wydatek pozycji 19 (wykaz składników majątkowych). */
export interface BudgetFixedAssetExpense {
  id: string;
  title: string;
  expense_date: string;
  invoice_number: string | null;
  vendor: string | null;
  amount: number;
}

/** Wynik `get_budget_year_summary(p_year)`: okres 1 stycznia - dziś (bieżący rok) lub 31 grudnia. */
export interface BudgetYearSummary {
  year: number;
  date_from: string;
  /** Koniec okresu (włącznie): dziś (Europe/Warsaw) w bieżącym roku, inaczej 31 grudnia. */
  date_to: string;
  as_of: string;
  total: number;
  count: number;
  /** Wydatki bez pliku faktury/paragonu (`missing_invoice_file`). */
  missing_invoice_count: number;
  missing_invoice_total: number;
  categories: BudgetYearCategoryTotal[];
  fixed_assets: BudgetFixedAssetExpense[];
}

// ===== MCP Integration =====

export interface McpToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  /** NULL = bezterminowy (tylko stare tokeny); nowe ręczne tokeny: 90 dni. */
  expires_at: string | null;
}

// ===== Podział obowiązków =====

/** Obszary z opiekunami (Kontakty bez opiekuna, Sprawy mają assigned_to per sprawa). */
export type OwnedModule = 'kalendarz' | 'teren' | 'interpelacje' | 'budzet' | 'newsletter';

/** Opiekun obszaru. */
export interface ModuleOwner {
  module: OwnedModule;
  user_id: string;
  position: 1 | 2;
  user: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'is_active'> | null;
}

/** Puls Biura: ok | osłabienie działań | bardzo duży spadek działań. */
export type PulseLevel = 'ok' | 'warning' | 'critical';

/**
 * Wiersz `get_module_pulse()`; liczby i powody tylko dla Posła/Administratora (inaczej null).
 * recent_count = ostatnie 14 dni, baseline_avg = średnia na 14 dni z 8 tygodni.
 */
export interface ModulePulse {
  module: OwnedModule;
  level: PulseLevel;
  recent_count: number | null;
  baseline_avg: number | null;
  reasons: string[] | null;
  /** Dni z logowaniem albo użyciem MCP w ostatnich 14 dniach. */
  owner_activity: OwnerActivity[] | null;
}

export interface OwnerActivity {
  user_id: string;
  full_name: string;
  active_days: number;
  last_active_at: string | null;
}

export type PersonPulseMetric =
  | 'active_days'
  | 'actions'
  | 'events_created'
  | 'cases_resolved'
  | 'interpellations'
  | 'expenses_added';

/** Wiersz `get_person_pulse(user_id)`: okresy "do tego samego momentu" + 8 ostatnich tygodni. */
export interface PersonPulseRow {
  metric: PersonPulseMetric;
  this_week: number;
  prev_week: number;
  this_month: number;
  prev_month: number;
  weekly: number[];
}
