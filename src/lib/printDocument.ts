// Pomocnik: otwiera nowe okno z dokumentem do druku/zapisu jako PDF.
// Zaleta: bez nowych zależności, polskie znaki działa out-of-the-box (font systemowy).

import { DEFAULT_SITE_IDENTITY, type SiteIdentity } from './siteContent';

interface PrintHtmlOptions {
  title: string;
  bodyHtml: string;
  /** Subtytuł widoczny tylko w nagłówku raportu (data wygenerowania, zakres). */
  subtitle?: string;
  /**
   * Tożsamość instancji do nagłówka raportu - wywołujący przekazuje `useSiteContent().data?.identity`.
   * `undefined` (treść jeszcze się nie wczytała / błąd odczytu) = neutralny nagłówek bez nazwiska.
   */
  identity: SiteIdentity | undefined;
}

/** "Biuro Poselskie Jana Kowalskiego · Okręg wyborczy nr 1 - ..." - bez danych posła samo "Biuro Poselskie". */
function printBrandLine(identity: SiteIdentity): string {
  const office = identity.mp_name_genitive ? `Biuro Poselskie ${identity.mp_name_genitive}` : 'Biuro Poselskie';
  return identity.district_label ? `${office} · ${identity.district_label}` : office;
}


// Okno about:blank dziedziczy CSP aplikacji (script-src bez 'unsafe-inline'), wiec zamiast
// inline <script>/onclick podpinamy akcje z okna-rodzica (same-origin).
function wirePrintWindow(win: Window): void {
  win.document.querySelector('[data-action="print"]')?.addEventListener('click', () => win.print());
  win.document.querySelector('[data-action="close"]')?.addEventListener('click', () => win.close());
  win.setTimeout(() => win.print(), 300);
}

// Otwiera nowe okno z gotowym HTML - używane dla raportów strukturalnych
// (tabele, sekcje, statystyki). bodyHtml jest wstawiany RAW, więc wywołujący
// odpowiada za escape danych userowych (użyj escapeHtml).
export function openPrintHtml({ title, subtitle, bodyHtml, identity = DEFAULT_SITE_IDENTITY }: PrintHtmlOptions): void {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    alert('Przeglądarka zablokowala wyskakujace okienko. Zezwól na popup z tej strony.');
    return;
  }

  const safeTitle = escapeHtml(title);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : '';
  const safeBrand = escapeHtml(printBrandLine(identity));
  const safeHost = escapeHtml(window.location.host);
  const generated = new Date().toLocaleString('pl-PL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  win.document.write(`<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page { size: A4; margin: 18mm 14mm 18mm 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.5;
      color: #0f172a;
      margin: 0;
      padding: 16mm 12mm;
    }
    @media print { body { padding: 0; } }
    .toolbar {
      position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 999;
    }
    .toolbar button {
      padding: 8px 14px; font-size: 13px; border: 1px solid #cbd5e1;
      background: #f8fafc; border-radius: 6px; cursor: pointer;
    }
    .toolbar button:hover { background: #e2e8f0; }
    @media print { .toolbar { display: none; } }

    .doc-header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px; margin-bottom: 16px;
    }
    .doc-header .brand {
      font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;
    }
    .doc-header .title {
      font-size: 16pt; font-weight: 600; margin: 4px 0 2px 0;
    }
    .doc-header .subtitle { font-size: 10pt; color: #475569; }

    .doc-footer {
      margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
      font-size: 9pt; color: #64748b; display: flex; justify-content: space-between;
    }

    .stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 18px 0; }
    .stat {
      flex: 1 1 140px; border: 1px solid #e2e8f0; border-radius: 6px;
      padding: 10px 14px; background: #f8fafc;
    }
    .stat .label { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat .value { font-size: 18pt; font-weight: 600; color: #0f172a; margin-top: 2px; }

    table { width: 100%; border-collapse: collapse; margin: 8px 0 16px 0; }
    th, td { padding: 6px 8px; text-align: left; vertical-align: top; }
    th {
      background: #f1f5f9; font-size: 9pt; text-transform: uppercase;
      letter-spacing: 0.04em; color: #475569; font-weight: 600;
      border-bottom: 1px solid #cbd5e1;
    }
    td { border-bottom: 1px solid #f1f5f9; font-size: 10pt; }
    tr:last-child td { border-bottom: none; }
    tr { page-break-inside: avoid; }

    h2 { font-size: 13pt; margin: 18px 0 8px 0; color: #0f172a; }
    h3 { font-size: 11pt; margin: 14px 0 6px 0; color: #1e293b; }

    .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 9pt; font-weight: 500; }
    .badge-create { background: #dcfce7; color: #166534; }
    .badge-update { background: #dbeafe; color: #1e40af; }
    .badge-delete { background: #fee2e2; color: #991b1b; }
    .badge-status { background: #fef3c7; color: #92400e; }
    .badge-other { background: #e2e8f0; color: #475569; }

    .empty { text-align: center; color: #94a3b8; padding: 24px; font-size: 11pt; }

    code, pre {
      font-family: 'Consolas', 'Courier New', monospace; font-size: 8.5pt;
      background: #f8fafc; padding: 1px 4px; border-radius: 3px;
    }
    pre { white-space: pre-wrap; word-wrap: break-word; padding: 8px 10px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" data-action="print">Drukuj / zapisz PDF</button>
    <button type="button" data-action="close">Zamknij</button>
  </div>

  <div class="doc-header">
    <div class="brand">${safeBrand}</div>
    <div class="title">${safeTitle}</div>
    ${safeSubtitle ? `<div class="subtitle">${safeSubtitle}</div>` : ''}
  </div>

  ${bodyHtml}

  <div class="doc-footer">
    <span>Wygenerowano: ${generated}</span>
    <span>${safeHost}</span>
  </div>

</body>
</html>`);
  win.document.close();
  wirePrintWindow(win);
}

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
