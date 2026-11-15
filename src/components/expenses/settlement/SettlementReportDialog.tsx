import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import templateUrl from '@/assets/templates/sprawozdanie-ryczalt.docx?url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOffices } from '@/hooks/useOffices';
import { useSiteContent } from '@/hooks/useSiteContent';
import type { BudgetYearSummary } from '@/integrations/supabase/types';
import { errorMessage } from '@/lib/errors';
import { formatPLN } from '@/lib/expenses';
import { addAmounts, formatAmountPl, type Settlement } from '@/lib/settlement';
import { DOCX_MIME, INVENTORY_ROWS_CAPACITY, buildSettlementDocx } from '@/lib/settlementDocx';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: BudgetYearSummary;
  settlement: Settlement;
  /** Domyślna kwota pkt 1 (limit miesięczny × miesiące okresu). */
  defaultFundsTransferred: number;
}

interface FormState {
  mpName: string;
  legitimationNo: string;
  officeAddress: string;
  fundsTransferred: string;
  fundsCarriedOver: string;
  interest: string;
  place: string;
  signedOn: string;
}

type AmountField = 'fundsTransferred' | 'fundsCarriedOver' | 'interest';

const AMOUNT_FIELDS: { key: AmountField; label: string; hint: string }[] = [
  { key: 'fundsTransferred', label: '1. Środki przekazane w okresie (zł)', hint: 'Domyślnie limit miesięczny × liczba miesięcy okresu.' },
  { key: 'fundsCarriedOver', label: '2. Niewykorzystane w poprzednim okresie (zł)', hint: 'Saldo z poprzedniego sprawozdania.' },
  { key: 'interest', label: '3. Odsetki za okres (zł)', hint: 'Odsetki na rachunku biura w okresie.' },
];

/** "1 234,56" / "1234.56" / "0" -> liczba; null gdy to nie kwota (maks. 2 miejsca po przecinku). */
function parseAmount(raw: string): number | null {
  const normalized = raw.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Generowanie sprawozdania rocznego (DOCX z oficjalnego szablonu) z danymi do uzupełnienia. */
export function SettlementReportDialog({ open, onOpenChange, summary, settlement, defaultFundsTransferred }: Props) {
  const siteQuery = useSiteContent();
  const officesQuery = useOffices({ activeOnly: true });
  const [form, setForm] = useState<FormState | null>(null);
  const [generating, setGenerating] = useState(false);

  const mainOffice = officesQuery.data?.find((o) => o.is_main) ?? officesQuery.data?.[0];
  const identity = siteQuery.data?.identity;
  const prefillReady = !siteQuery.isPending && !officesQuery.isPending;

  // Wartości startowe przy każdym otwarciu - po wczytaniu danych posła i biura.
  useEffect(() => {
    if (!open) {
      setForm(null);
      return;
    }
    if (!prefillReady) return;
    setForm(
      (prev) =>
        prev ?? {
          mpName: identity?.mp_name ?? '',
          legitimationNo: '',
          officeAddress: mainOffice ? [mainOffice.address, mainOffice.city].filter(Boolean).join(', ') : '',
          fundsTransferred: formatAmountPl(defaultFundsTransferred),
          fundsCarriedOver: formatAmountPl(0),
          interest: formatAmountPl(0),
          place: mainOffice?.city ?? '',
          signedOn: format(new Date(), 'yyyy-MM-dd'),
        },
    );
  }, [open, prefillReady, identity, mainOffice, defaultFundsTransferred]);

  if (!form) return null;

  const set = (key: keyof FormState, value: string) => setForm({ ...form, [key]: value });
  const amounts = {
    fundsTransferred: parseAmount(form.fundsTransferred),
    fundsCarriedOver: parseAmount(form.fundsCarriedOver),
    interest: parseAmount(form.interest),
  };
  const amountsValid = Object.values(amounts).every((a) => a !== null);
  const fundsTotal = amountsValid
    ? addAmounts(amounts.fundsTransferred!, amounts.fundsCarriedOver!, amounts.interest!)
    : null;
  const legitimationValid = /^\d{0,3}$/.test(form.legitimationNo.trim());
  const canGenerate = amountsValid && legitimationValid && form.signedOn !== '' && !generating;

  const generate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const response = await fetch(templateUrl);
      if (!response.ok) throw new Error(`Nie udało się pobrać szablonu (HTTP ${response.status})`);
      const docx = buildSettlementDocx(new Uint8Array(await response.arrayBuffer()), {
        year: summary.year,
        dateFrom: summary.date_from,
        dateTo: summary.date_to,
        mpName: form.mpName,
        legitimationNo: form.legitimationNo.trim(),
        officeAddress: form.officeAddress,
        fundsTransferred: amounts.fundsTransferred!,
        fundsCarriedOver: amounts.fundsCarriedOver!,
        interest: amounts.interest!,
        lines: settlement.lines,
        total: settlement.total,
        fixedAssets: summary.fixed_assets,
        place: form.place,
        signedOn: form.signedOn,
      });
      // zipSync alokuje zwykły ArrayBuffer (nie SharedArrayBuffer).
      const url = URL.createObjectURL(new Blob([docx as Uint8Array<ArrayBuffer>], { type: DOCX_MIME }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `sprawozdanie-ryczalt-${summary.year}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Sprawozdanie wygenerowane', { description: 'Sprawdź dokument przed podpisem.' });
      onOpenChange(false);
    } catch (err) {
      toast.error('Nie udało się wygenerować sprawozdania', { description: errorMessage(err) });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>Sprawozdanie z wydatkowania ryczałtu {summary.year}</DialogTitle>
          <DialogDescription>
            Dokument Word na oficjalnym formularzu Kancelarii Sejmu za okres{' '}
            {format(new Date(`${summary.date_from}T12:00:00`), 'dd.MM.yyyy')} -{' '}
            {format(new Date(`${summary.date_to}T12:00:00`), 'dd.MM.yyyy')}. Kwoty pozycji pochodzą z kategorii; pola
            poniżej uzupełnij przed wygenerowaniem.
          </DialogDescription>
        </DialogHeader>

        <form
          id="settlement-report-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="settlement-mp-name">Imię i nazwisko posła</Label>
            <Input
              id="settlement-mp-name"
              value={form.mpName}
              onChange={(e) => set('mpName', e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settlement-leg-no">Nr legitymacji</Label>
            <Input
              id="settlement-leg-no"
              inputMode="numeric"
              value={form.legitimationNo}
              onChange={(e) => set('legitimationNo', e.target.value)}
              aria-invalid={!legitimationValid}
              aria-describedby="settlement-leg-no-hint"
              autoComplete="off"
            />
            <p
              id="settlement-leg-no-hint"
              className={legitimationValid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
            >
              {legitimationValid ? 'Do 3 cyfr; puste = do wpisania ręcznie.' : 'Wpisz do 3 cyfr.'}
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="settlement-address">Adres biura poselskiego</Label>
            <Input
              id="settlement-address"
              value={form.officeAddress}
              onChange={(e) => set('officeAddress', e.target.value)}
              autoComplete="off"
            />
          </div>

          {AMOUNT_FIELDS.map(({ key, label, hint }) => {
            const invalid = amounts[key] === null;
            return (
              <div key={key} className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`settlement-${key}`}>{label}</Label>
                <Input
                  id={`settlement-${key}`}
                  inputMode="decimal"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  aria-invalid={invalid}
                  aria-describedby={`settlement-${key}-hint`}
                  autoComplete="off"
                />
                <p
                  id={`settlement-${key}-hint`}
                  className={invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                >
                  {invalid ? 'Podaj kwotę, np. 1234,56.' : hint}
                </p>
              </div>
            );
          })}

          <div className="space-y-1.5">
            <Label htmlFor="settlement-place">Miejscowość</Label>
            <Input
              id="settlement-place"
              value={form.place}
              onChange={(e) => set('place', e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settlement-date">Data sprawozdania</Label>
            <Input
              id="settlement-date"
              type="date"
              value={form.signedOn}
              onChange={(e) => set('signedOn', e.target.value)}
            />
          </div>
        </form>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm tabular-nums">
          <dt className="text-muted-foreground">4. Do rozliczenia ogółem</dt>
          <dd className="text-right font-medium">{fundsTotal === null ? '-' : formatPLN(fundsTotal)}</dd>
          <dt className="text-muted-foreground">Wydatkowano wg zestawienia</dt>
          <dd className="text-right font-medium">{formatPLN(settlement.total)}</dd>
          <dt className="text-muted-foreground">Pozostało</dt>
          <dd className="text-right font-semibold">
            {fundsTotal === null ? '-' : formatPLN(addAmounts(fundsTotal, -settlement.total))}
          </dd>
        </dl>

        {summary.fixed_assets.length > INVENTORY_ROWS_CAPACITY && (
          <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Wykaz składników majątkowych (poz. 19) ma {summary.fixed_assets.length} pozycji, a pole wykazu w formularzu
            mieści ok. {INVENTORY_ROWS_CAPACITY}. Po otwarciu dokumentu powiększ pole lub przenieś nadmiar na kolejną
            stronę.
          </p>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button type="submit" form="settlement-report-form" disabled={!canGenerate}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown />}
            Pobierz DOCX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
