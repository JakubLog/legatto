/** Wynik zadania cron: kod HTTP i ciało odpowiedzi (api/cron/[job].ts). */
export interface CronJobResult {
  status: number;
  body: Record<string, unknown>;
}
