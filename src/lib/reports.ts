// Buildery raportów PDF - generują HTML dla openPrintHtml().
// Każdy builder zwraca { title, subtitle, bodyHtml }.

import type { AuditLog, CaseWithRelations, PowiatVisibilityStats } from '@/integrations/supabase/types';
import { escapeHtml } from './printDocument';

const STATUS_LABEL: Record<string, string> = {
  nowa: 'Nowa',
  w_toku: 'W toku',
  oczekuje: 'Oczekuje',
  załatwiona: 'Załatwiona',
  odrzucona: 'Odrzucona',
  open: 'Otwarte (bez załatwionych i odrzuconych)',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
  urgent: 'Pilny',
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  return new Date(s).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateOnly(s: string | null | undefined): string {
  if (!s) return '-';
  return new Date(s).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function badgeClassForAction(action: string): string {
  if (action.endsWith('.create')) return 'badge badge-create';
  if (action.endsWith('.delete')) return 'badge badge-delete';
  if (action.endsWith('.status_change')) return 'badge badge-status';
  if (action.endsWith('.update')) return 'badge badge-update';
  return 'badge badge-other';
}

function rangeSubtitle(from?: string | null, to?: string | null): string {
  if (from && to) return `Zakres: ${fmtDateOnly(from)} - ${fmtDateOnly(to)}`;
  if (from) return `Zakres: od ${fmtDateOnly(from)}`;
  if (to) return `Zakres: do ${fmtDateOnly(to)}`;
  return 'Zakres: cały okres';
}

// ===== AUDIT LOG =====

export interface AuditReportInput {
  rows: AuditLog[];
  filters: {
    from?: string | null;
    to?: string | null;
    action?: string | null;
    entityType?: string | null;
    userEmail?: string | null;
  };
}

export function buildAuditReport({ rows, filters }: AuditReportInput): {
  title: string;
  subtitle: string;
  bodyHtml: string;
} {
  const title = 'Dziennik zmian (audit log)';
  const parts = [rangeSubtitle(filters.from, filters.to)];
  if (filters.action) parts.push(`Akcja: ${filters.action}`);
  if (filters.entityType) parts.push(`Typ: ${filters.entityType}`);
  if (filters.userEmail) parts.push(`Użytkownik: ${filters.userEmail}`);
  const subtitle = parts.join(' • ');

  if (rows.length === 0) {
    return {
      title,
      subtitle,
      bodyHtml: '<div class="empty">Brak wpisów w wybranym zakresie.</div>',
    };
  }

  const stats = `
    <div class="stats">
      <div class="stat"><div class="label">Wpisy</div><div class="value">${rows.length}</div></div>
      <div class="stat"><div class="label">Użytkownicy</div><div class="value">${
        new Set(rows.map((r) => r.user_email).filter(Boolean)).size
      }</div></div>
      <div class="stat"><div class="label">Pierwszy</div><div class="value" style="font-size:11pt">${fmtDate(
        rows[rows.length - 1]?.created_at,
      )}</div></div>
      <div class="stat"><div class="label">Ostatni</div><div class="value" style="font-size:11pt">${fmtDate(
        rows[0]?.created_at,
      )}</div></div>
    </div>
  `;

  const tableRows = rows
    .map((r) => {
      const meta = r.metadata ? formatMetadata(r.metadata) : '';
      return `<tr>
        <td style="white-space:nowrap;">${escapeHtml(fmtDate(r.created_at))}</td>
        <td>${escapeHtml(r.user_email ?? '-')}</td>
        <td><span class="${badgeClassForAction(r.action)}">${escapeHtml(r.action)}</span></td>
        <td>${escapeHtml(r.entity_type ?? '-')}</td>
        <td style="font-size:9pt; color:#475569;">${meta}</td>
      </tr>`;
    })
    .join('');

  const bodyHtml = `
    ${stats}
    <table>
      <thead>
        <tr>
          <th style="width: 16%;">Data i czas</th>
          <th style="width: 22%;">Użytkownik</th>
          <th style="width: 16%;">Akcja</th>
          <th style="width: 12%;">Typ</th>
          <th>Szczegóły</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  return { title, subtitle, bodyHtml };
}

function formatMetadata(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta).filter(([, v]) => v != null);
  if (entries.length === 0) return '-';
  return entries
    .map(([k, v]) => {
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(value)}`;
    })
    .join('<br/>');
}

// ===== SPRAWY =====

export interface CasesReportInput {
  rows: CaseWithRelations[];
  filters: {
    status?: string | null;
    priority?: string | null;
    categoryId?: number | null;
    assignedTo?: string | null;
    search?: string;
  };
}

export function buildCasesReport({ rows, filters }: CasesReportInput): {
  title: string;
  subtitle: string;
  bodyHtml: string;
} {
  const title = 'Raport: Sprawy wyborców';
  const parts: string[] = [];
  if (filters.status) parts.push(`Status: ${STATUS_LABEL[filters.status] ?? filters.status}`);
  if (filters.priority) parts.push(`Priorytet: ${PRIORITY_LABEL[filters.priority] ?? filters.priority}`);
  if (filters.search) parts.push(`Szukaj: "${filters.search}"`);
  const subtitle = parts.length > 0 ? parts.join(' • ') : 'Wszystkie sprawy';

  if (rows.length === 0) {
    return {
      title,
      subtitle,
      bodyHtml: '<div class="empty">Brak spraw spełniających kryteria.</div>',
    };
  }

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
  }

  const stats = `
    <div class="stats">
      <div class="stat"><div class="label">Łącznie</div><div class="value">${rows.length}</div></div>
      <div class="stat"><div class="label">W toku</div><div class="value">${byStatus.w_toku ?? 0}</div></div>
      <div class="stat"><div class="label">Załatwione</div><div class="value">${byStatus.załatwiona ?? 0}</div></div>
      <div class="stat"><div class="label">Pilne</div><div class="value">${byPriority.urgent ?? 0}</div></div>
    </div>
  `;

  const tableRows = rows
    .map((r) => {
      const reporter = r.contact
        ? `${r.contact.first_name} ${r.contact.last_name}`
        : r.reporter_name ?? '-';
      const region = [r.powiat?.name, r.gmina?.name].filter(Boolean).join(' / ') || '-';
      return `<tr>
        <td>${escapeHtml(r.title)}</td>
        <td><span class="badge badge-other">${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}</span></td>
        <td>${escapeHtml(PRIORITY_LABEL[r.priority] ?? r.priority)}</td>
        <td>${escapeHtml(r.category?.name ?? '-')}</td>
        <td>${escapeHtml(reporter)}</td>
        <td style="white-space:nowrap;">${escapeHtml(region)}</td>
        <td>${escapeHtml(r.assigned?.full_name ?? '-')}</td>
        <td style="white-space:nowrap;">${escapeHtml(fmtDateOnly(r.due_date))}</td>
      </tr>`;
    })
    .join('');

  const bodyHtml = `
    ${stats}
    <table>
      <thead>
        <tr>
          <th>Tytuł</th>
          <th>Status</th>
          <th>Priorytet</th>
          <th>Kategoria</th>
          <th>Zgłaszający</th>
          <th>Powiat / Gmina</th>
          <th>Przypisana</th>
          <th>Termin</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  return { title, subtitle, bodyHtml };
}

// ===== WIDOCZNOŚĆ W TERENIE =====

export interface VisibilityReportInput {
  stats: PowiatVisibilityStats[];
  thresholds: { warningDays: number; criticalDays: number };
}

export function buildVisibilityReport({ stats, thresholds }: VisibilityReportInput): {
  title: string;
  subtitle: string;
  bodyHtml: string;
} {
  const title = 'Raport: Widoczność w terenie';
  const subtitle = `Progi alertow: ostrzeżenie po ${thresholds.warningDays} dniach, krytyczny po ${thresholds.criticalDays} dniach`;

  if (stats.length === 0) {
    return {
      title,
      subtitle,
      bodyHtml: '<div class="empty">Brak danych statystycznych.</div>',
    };
  }

  let critical = 0;
  let warning = 0;
  let ok = 0;
  for (const s of stats) {
    const days = s.days_since_last_event;
    if (days == null || days >= thresholds.criticalDays) critical++;
    else if (days >= thresholds.warningDays) warning++;
    else ok++;
  }

  const totalEvents = stats.reduce((sum, s) => sum + (s.events_count ?? 0), 0);

  const statsCards = `
    <div class="stats">
      <div class="stat"><div class="label">Powiaty OK</div><div class="value" style="color:#166534;">${ok}</div></div>
      <div class="stat"><div class="label">Ostrzeżenie</div><div class="value" style="color:#92400e;">${warning}</div></div>
      <div class="stat"><div class="label">Krytyczne</div><div class="value" style="color:#991b1b;">${critical}</div></div>
      <div class="stat"><div class="label">Wszystkie wydarzenia</div><div class="value">${totalEvents}</div></div>
    </div>
  `;

  const tableRows = stats
    .slice()
    .sort((a, b) => {
      const da = a.days_since_last_event ?? Infinity;
      const db = b.days_since_last_event ?? Infinity;
      return db - da;
    })
    .map((s) => {
      const days = s.days_since_last_event;
      let status = 'OK';
      let badgeClass = 'badge-create';
      if (days == null) {
        status = 'Brak wydarzen';
        badgeClass = 'badge-delete';
      } else if (days >= thresholds.criticalDays) {
        status = 'Krytyczny';
        badgeClass = 'badge-delete';
      } else if (days >= thresholds.warningDays) {
        status = 'Ostrzeżenie';
        badgeClass = 'badge-status';
      }
      return `<tr>
        <td>${escapeHtml(s.powiat_name)}${s.is_city ? ' (miasto)' : ''}</td>
        <td>${s.contacts_count}</td>
        <td>${s.events_count}</td>
        <td style="white-space:nowrap;">${escapeHtml(fmtDateOnly(s.last_event_at))}</td>
        <td>${days == null ? '-' : days}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(status)}</span></td>
      </tr>`;
    })
    .join('');

  const bodyHtml = `
    ${statsCards}
    <h2>Statystyki per powiat</h2>
    <table>
      <thead>
        <tr>
          <th>Powiat</th>
          <th>Kontakty</th>
          <th>Wydarzenia</th>
          <th>Ostatnie wydarzenie</th>
          <th>Dni od ostatniego</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  return { title, subtitle, bodyHtml };
}
