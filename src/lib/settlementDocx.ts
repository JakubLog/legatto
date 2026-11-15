// Wypełnia oficjalny szablon sprawozdania z wydatkowania ryczałtu (DOCX z Kancelarii Sejmu,
// src/assets/templates/sprawozdanie-ryczalt.docx) danymi rozliczenia roku.
//
// Szablon edytuje się tylko przez DOM `word/document.xml`: akapity i komórki są odnajdywane
// po stałych tekstach formularza ("1. Środki finansowe przekazane", numery pozycji "1.".."22.",
// podpozycje "1.".."5." pod pozycją 22, "Razem:"), formatowanie bierze się z pierwszego runu.
// Wynik zostaje edytowalnym dokumentem Word (uwagi, poprawki ręczne przed podpisem).

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import type { BudgetFixedAssetExpense } from '@/integrations/supabase/types';
import { addAmounts, formatAmountPl, type SettlementLine } from './settlement';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const DOCUMENT_PATH = 'word/document.xml';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Wykaz leży w polu tekstowym o stałej wysokości (bez autodopasowania) - mieści ok. 14 wierszy
 * (tyle pustych linii ma szablon). Dalsze pozycje są w pliku, ale poza widocznym polem.
 */
export const INVENTORY_ROWS_CAPACITY = 14;

export interface SettlementDocInput {
  year: number;
  /** ISO YYYY-MM-DD, włącznie. */
  dateFrom: string;
  dateTo: string;
  mpName: string;
  /** Numer legitymacji poselskiej (do 3 cyfr, po jednej w kratce). */
  legitimationNo: string;
  officeAddress: string;
  /** Pkt 1-3 formularza (zł). */
  fundsTransferred: number;
  fundsCarriedOver: number;
  interest: number;
  /** Wiersze z `buildSettlement` (1-21, 22, 22.1-22.5). */
  lines: SettlementLine[];
  /** Suma pozycji ("wydatkowano wg powyższego zestawienia"). */
  total: number;
  /** Wydatki pozycji 19 - wykaz składników majątkowych. */
  fixedAssets: BudgetFixedAssetExpense[];
  /** Miejscowość i data podpisu (ISO). */
  place: string;
  signedOn: string;
}

const isW = (node: Node, localName: string): node is Element =>
  node.nodeType === 1 && (node as Element).namespaceURI === W_NS && (node as Element).localName === localName;

function childrenW(el: Element, localName: string): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => isW(n, localName));
}

function textOf(el: Element): string {
  return Array.from(el.getElementsByTagNameNS(W_NS, 't'))
    .map((t) => t.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Zastępuje treść akapitu jednym runem z formatowaniem pierwszego runu (lub znacznika akapitu). */
function setParagraphText(p: Element, text: string): void {
  const doc = p.ownerDocument;
  const runs = childrenW(p, 'r');
  let rPr = runs.map((r) => childrenW(r, 'rPr')[0]).find(Boolean) ?? null;
  if (!rPr) {
    const pPr = childrenW(p, 'pPr')[0];
    rPr = pPr ? (childrenW(pPr, 'rPr')[0] ?? null) : null;
  }
  for (const r of runs) p.removeChild(r);

  const run = doc.createElementNS(W_NS, 'w:r');
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  run.appendChild(t);
  p.appendChild(run);
}

/** Treść komórki = jeden akapit (pierwszy, z jego formatowaniem). */
function setCellText(tc: Element, text: string): void {
  const [first, ...rest] = childrenW(tc, 'p');
  for (const p of rest) tc.removeChild(p);
  const p = first ?? tc.appendChild(tc.ownerDocument.createElementNS(W_NS, 'w:p'));
  setParagraphText(p, text);
}

function paragraphs(doc: Document, startsWith: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).filter((p) => textOf(p).startsWith(startsWith));
}

function requireParagraph(doc: Document, startsWith: string): Element {
  const p = paragraphs(doc, startsWith)[0];
  if (!p) throw new Error(`Szablon sprawozdania: brak akapitu "${startsWith}"`);
  return p;
}

function previousParagraph(p: Element): Element | null {
  let node = p.previousSibling;
  while (node && !isW(node, 'p')) node = node.previousSibling;
  return node as Element | null;
}

/** Komórka z wartością (zł) obok komórki z etykietą pkt 1-4. */
function valueCellNextTo(label: Element): Element {
  let tc: Node | null = label.parentNode;
  while (tc && !isW(tc, 'tc')) tc = tc.parentNode;
  let next = tc?.nextSibling ?? null;
  while (next && !isW(next, 'tc')) next = next.nextSibling;
  if (!next) throw new Error('Szablon sprawozdania: brak komórki kwoty');
  return next;
}

/** Usuwa identyfikatory akapitów Worda (w14:paraId/textId) - w klonach muszą być unikalne. */
function stripWordIds(el: Element): void {
  for (const node of [el, ...Array.from(el.getElementsByTagName('*'))]) {
    node.removeAttributeNS(W14_NS, 'paraId');
    node.removeAttributeNS(W14_NS, 'textId');
  }
}

const longDate = (iso: string) => format(new Date(`${iso}T12:00:00`), 'd MMMM', { locale: pl });
const zl = (amount: number) => `${formatAmountPl(amount)} zł`;

export function buildSettlementDocx(template: Uint8Array, input: SettlementDocInput): Uint8Array {
  const files = unzipSync(template);
  const xml = files[DOCUMENT_PATH];
  if (!xml) throw new Error('Szablon sprawozdania: brak word/document.xml');
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Szablon sprawozdania: niepoprawny XML');
  }
  const [legitimationTable, expensesTable] = childrenW(body, 'tbl');
  if (!legitimationTable || !expensesTable) throw new Error('Szablon sprawozdania: brak tabel formularza');

  const period = `od dnia ${longDate(input.dateFrom)} do dnia ${longDate(input.dateTo)} ${input.year} roku`;
  const fundsTotal = addAmounts(input.fundsTransferred, input.fundsCarriedOver, input.interest);
  const mpName = input.mpName.trim();
  const address = input.officeAddress.trim();

  // Nagłówek: poseł, nr legitymacji (kratki), adres biura, okres.
  if (mpName) {
    const line = previousParagraph(requireParagraph(doc, '(imię i nazwisko posła)'));
    if (line) setParagraphText(line, mpName);
  }
  const digits = input.legitimationNo.replace(/\D/g, '').slice(-3);
  if (digits) {
    const boxes = childrenW(childrenW(legitimationTable, 'tr')[0], 'tc');
    const padded = digits.padStart(boxes.length, ' ');
    boxes.forEach((tc, i) => setCellText(tc, padded[i]?.trim() ?? ''));
  }
  if (address) {
    const line = previousParagraph(requireParagraph(doc, '(adres biura poselskiego)'));
    if (line) setParagraphText(line, address);
  }
  setParagraphText(requireParagraph(doc, 'za okres od dnia'), `za okres ${period}`);

  // Pkt 1-4: środki do rozliczenia.
  const transferred = requireParagraph(doc, '1. Środki finansowe przekazane');
  setParagraphText(transferred, `1. Środki finansowe przekazane w okresie ${period}`);
  setCellText(valueCellNextTo(transferred), zl(input.fundsTransferred));
  setCellText(valueCellNextTo(requireParagraph(doc, '2. Środki finansowe niewykorzystane')), zl(input.fundsCarriedOver));
  const interest = requireParagraph(doc, '3. Odsetki za okres');
  setParagraphText(
    interest,
    `3. Odsetki za okres od dnia ${longDate(input.dateFrom)} do dnia: ${longDate(input.dateTo)} ${input.year} roku`,
  );
  setCellText(valueCellNextTo(interest), zl(input.interest));
  setCellText(valueCellNextTo(requireParagraph(doc, '4. Środki finansowe do rozliczenia ogółem')), zl(fundsTotal));

  // Pozycje 1-22 i podpozycje 22.1-22.5. Wiersze pozycji: [Lp, Rodzaj, Kwota, Uwagi];
  // podpozycje: [pusta, Lp, Rodzaj, Kwota, Uwagi]; "Razem:": [etykieta, Kwota, Uwagi].
  const amountByCode = new Map(input.lines.map((l) => [l.code, l.amount]));
  const filled = new Set<string>();
  let inOther = false;
  for (const tr of childrenW(expensesTable, 'tr')) {
    const cells = childrenW(tr, 'tc');
    const texts = cells.map(textOf);
    let code: string | null = null;
    let amountCell: Element | undefined;
    if (cells.length === 4 && /^\d{1,2}\.$/.test(texts[0])) {
      code = texts[0].slice(0, -1);
      amountCell = cells[2];
      inOther = code === '22';
    } else if (inOther && cells.length === 5 && /^[1-5]\.$/.test(texts[1])) {
      code = `22.${texts[1].slice(0, -1)}`;
      amountCell = cells[3];
      if (code === '22.5' && !texts[2]) setCellText(cells[2], 'Pozostałe');
    } else if (texts[0].startsWith('Razem')) {
      setCellText(cells[1], zl(input.total));
      filled.add('razem');
      continue;
    }
    if (!code || !amountCell) continue;
    const amount = amountByCode.get(code);
    if (amount === undefined) continue;
    setCellText(amountCell, zl(amount));
    filled.add(code);
  }
  const missing = input.lines.filter((l) => !filled.has(l.code)).map((l) => l.code);
  if (!filled.has('razem')) missing.push('Razem');
  if (missing.length > 0) throw new Error(`Szablon sprawozdania: brak wierszy ${missing.join(', ')}`);

  // Bilans.
  setParagraphText(
    requireParagraph(doc, 'Ze środków finansowych do rozliczenia ogółem'),
    `Ze środków finansowych do rozliczenia ogółem w wysokości: ${zl(fundsTotal)}`,
  );
  setParagraphText(
    requireParagraph(doc, 'wydatkowano wg powyższego zestawienia'),
    `wydatkowano wg powyższego zestawienia: ${zl(input.total)}`,
  );
  setParagraphText(requireParagraph(doc, 'pozostało:'), `pozostało: ${zl(addAmounts(fundsTotal, -input.total))}`);

  const signed = Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).find((p) => /^\.+, dnia/.test(textOf(p)));
  if (signed && input.place.trim()) {
    setParagraphText(
      signed,
      `${input.place.trim()}, dnia ${format(new Date(`${input.signedOn}T12:00:00`), 'dd.MM.yyyy')} r.`,
    );
  }

  // Wykaz składników majątkowych (pozycja 19): pole tekstowe na stronie poziomej, w pliku
  // dwukrotnie (DrawingML + zapasowy VML) - wypełniamy obie kopie.
  for (const p of paragraphs(doc, 'Posła :')) if (mpName) setParagraphText(p, `Posła: ${mpName}`);
  for (const p of paragraphs(doc, 'Adres biura:')) if (address) setParagraphText(p, `Adres biura: ${address}`);
  for (const p of paragraphs(doc, 'w roku')) setParagraphText(p, `w roku ${input.year}`);
  if (input.fixedAssets.length > 0) {
    const inventoryTables = Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl')).filter((tbl) => {
      const header = childrenW(tbl, 'tr')[0];
      return header !== undefined && textOf(header).includes('Nazwa przedmiotu');
    });
    if (inventoryTables.length === 0) throw new Error('Szablon sprawozdania: brak tabeli wykazu');
    for (const tbl of inventoryTables) {
      const [, templateRow] = childrenW(tbl, 'tr');
      if (!templateRow) continue;
      input.fixedAssets.forEach((asset, index) => {
        const row = templateRow.cloneNode(true) as Element;
        stripWordIds(row);
        const values = [
          `${index + 1}.`,
          asset.title,
          '',
          '',
          format(new Date(`${asset.expense_date}T12:00:00`), 'dd.MM.yyyy'),
          asset.invoice_number ?? '',
          zl(Number(asset.amount)),
          '',
        ];
        childrenW(row, 'tc').forEach((tc, i) => setCellText(tc, values[i] ?? ''));
        tbl.insertBefore(row, templateRow);
      });
      tbl.removeChild(templateRow);
    }
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  files[DOCUMENT_PATH] = strToU8(serialized.startsWith('<?xml') ? serialized : `${XML_DECLARATION}\n${serialized}`);
  return zipSync(files, { level: 6 });
}
