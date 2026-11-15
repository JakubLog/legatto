import { useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, FileSpreadsheet, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchSelect } from '@/components/ui/search-select';
import { CONTACT_TYPE_LABELS, CONTACT_TYPES } from '@/lib/contacts';
import {
  autoMap,
  isFirstLastTarget,
  isFullNameTarget,
  mapRows,
  parseFile,
  REQUIRED_FIELDS,
  TARGET_FIELD_LABELS,
  TARGET_FIELDS,
  type DictField,
  type Globals,
  type Mapping,
  type ParsedCsv,
  type TargetField,
} from '@/lib/csv-import';
import { useGminy } from '@/hooks/useGminy';
import { useImportContacts, type ImportResult, type ImportRow } from '@/hooks/useImportContacts';
import { usePowiaty } from '@/hooks/usePowiaty';
import type { ContactType } from '@/integrations/supabase/types';
import { ImportStepper, type ImportStep as Step } from './ImportStepper';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const DICT_LABELS: Record<DictField, string> = {
  type: 'typ kontaktu',
  powiat: 'powiat',
  gmina: 'gmina',
};

export function ImportContactsDialog({ open, onOpenChange }: Props) {
  const { data: powiaty = [] } = usePowiaty();
  const { data: gminy = [] } = useGminy();
  const { mutateAsync: doImport, isPending } = useImportContacts();

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [globals, setGlobals] = useState<Globals>({
    type: null,
    powiatId: null,
    gminaId: null,
  });
  const [applyGlobals, setApplyGlobals] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('upload');
    setParsed(null);
    setMapping({});
    setGlobals({ type: null, powiatId: null, gminaId: null });
    setApplyGlobals(false);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const p = await parseFile(file);
      if (p.headers.length === 0 || p.rows.length === 0) {
        toast.error('Plik jest pusty lub ma nieprawidłowy format');
        return;
      }
      setParsed(p);
      setMapping(autoMap(p.headers));
      setStep('mapping');
    } catch {
      toast.error('Nie udało się odczytać pliku');
    }
  };

  const mappedFields = useMemo(() => {
    const set = new Set<TargetField>();
    for (const v of Object.values(mapping)) {
      if (v !== 'skip') set.add(v);
    }
    return set;
  }, [mapping]);

  const isMapped = (f: TargetField) => mappedFields.has(f);

  const fullNameMapped =
    mappedFields.has('full_name_first_last') || mappedFields.has('full_name_last_first');
  const splitNameMapped = mappedFields.has('first_name') || mappedFields.has('last_name');

  const isBlocked = (f: TargetField, current: TargetField | 'skip'): boolean => {
    if (f === current) return false;
    if (mappedFields.has(f)) return true;
    if (isFirstLastTarget(f) && fullNameMapped) return true;
    if (isFullNameTarget(f) && splitNameMapped) return true;
    return false;
  };

  const showGlobal = {
    type: !isMapped('type'),
    powiat: !isMapped('powiat'),
    gmina: !isMapped('gmina') && !isMapped('powiat') && globals.powiatId !== null,
  };

  const lookups = useMemo(
    () => ({
      powiaty: powiaty.map(p => ({ id: p.id, name: p.name })),
      gminy: gminy.map(g => ({ id: g.id, name: g.name, powiat_id: g.powiat_id })),
    }),
    [powiaty, gminy],
  );

  const mapped = useMemo(() => {
    if (!parsed) return [];
    return mapRows({
      mapping,
      rows: parsed.rows,
      lookups,
      globals,
      applyGlobalsToInvalid: applyGlobals,
    });
  }, [parsed, mapping, lookups, globals, applyGlobals]);

  const valid = mapped.filter(r => r.errors.length === 0);
  const invalid = mapped.filter(r => r.errors.length > 0);

  const dictFailureCounts = useMemo(() => {
    const counts: Record<DictField, number> = { type: 0, powiat: 0, gmina: 0 };
    for (const r of mapped) {
      for (const f of r.dictFailures) counts[f]++;
    }
    return counts;
  }, [mapped]);

  const hasDictFailures =
    dictFailureCounts.type + dictFailureCounts.powiat + dictFailureCounts.gmina > 0;

  // Mapping step → walidacja możliwości przejścia dalej
  const requiredOk = (() => {
    const hasNamePair = isMapped('first_name') && isMapped('last_name');
    if (!hasNamePair && !fullNameMapped) return false;
    if (!isMapped('type') && !globals.type) return false;
    if (!isMapped('powiat') && !globals.powiatId) return false;
    return true;
  })();

  const updateMapping = (header: string, target: TargetField | 'skip') => {
    setMapping(prev => ({ ...prev, [header]: target }));
  };

  const handleImport = async () => {
    const rows: ImportRow[] = valid
      .filter(r => r.type && r.powiat_id)
      .map(r => ({
        type: r.type as ContactType,
        first_name: r.first_name,
        last_name: r.last_name,
        function: r.function,
        phone: r.phone,
        email: r.email,
        powiat_id: r.powiat_id as number,
        gmina_id: r.gmina_id,
        miejscowosc: r.miejscowosc,
        street: r.street,
        postal_code: r.postal_code,
        notes: r.notes,
      }));
    try {
      const res = await doImport(rows);
      setResult(res);
      setStep('done');
    } catch {
      toast.error('Błąd podczas importu. Spróbuj ponownie.');
    }
  };

  const globalGminyForPowiat = useMemo(
    () => (globals.powiatId ? gminy.filter(g => g.powiat_id === globals.powiatId) : []),
    [gminy, globals.powiatId],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/* Opis każdego kroku to zwykły akapit pod tytułem - bez DialogDescription. */}
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <ImportStepper step={step} />
        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle>Importuj kontakty z CSV</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Wgraj plik <strong>CSV</strong> (UTF-8) lub <strong>XLSX</strong>. Aplikacja
                wykryje nagłówki i zaproponuje mapowanie kolumn na pola w bazie. W kolejnym kroku
                będziesz mógł skorygować przypisania.
              </p>
              <div className="space-y-2">
                <Label htmlFor="contacts-import-file">Plik CSV / XLSX</Label>
                <button
                  type="button"
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-muted/20 p-8 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => fileRef.current?.click()}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileSpreadsheet className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-medium">Kliknij, aby wybrać plik</span>
                  <span className="text-xs text-muted-foreground">.csv, .xlsx, .xls</span>
                </button>
                <input
                  id="contacts-import-file"
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Anuluj
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'mapping' && parsed && (
          <>
            <DialogHeader>
              <DialogTitle>Dopasuj kolumny</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Wczytano <strong>{parsed.rows.length}</strong> wierszy. Sprawdź i ew. skoryguj
                automatyczne dopasowanie kolumn z pliku do pól w bazie. Pola wymagane oznaczone *.
              </p>

              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
                  <div>Zczytana zawartość</div>
                  <div />
                  <div>Dopasowana pozycja w bazie</div>
                </div>
                <div className="max-h-72 divide-y overflow-y-auto">
                  {parsed.headers.map(h => {
                    const samples = parsed.samples[h] ?? [];
                    const current = mapping[h] ?? 'skip';
                    return (
                      <div
                        key={h}
                        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{h}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {samples.length > 0 ? `np. ${samples.join(', ')}` : '— brak danych —'}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <Select
                          value={current}
                          onValueChange={v => updateMapping(h, v as TargetField | 'skip')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">
                              <span className="text-muted-foreground">— Pomiń —</span>
                            </SelectItem>
                            {TARGET_FIELDS.map(f => {
                              const blocked = isBlocked(f, current);
                              return (
                                <SelectItem key={f} value={f} disabled={blocked}>
                                  {TARGET_FIELD_LABELS[f]}
                                  {REQUIRED_FIELDS.has(f) && ' *'}
                                  {blocked && ' (zajęte)'}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {(showGlobal.type || showGlobal.powiat || showGlobal.gmina) && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <div className="text-sm font-medium">
                    Wartości globalne
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (uzupełnij dla pól, których nie ma w pliku)
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {showGlobal.type && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Typ kontaktu *</Label>
                        <Select
                          value={globals.type ?? ''}
                          onValueChange={v =>
                            setGlobals(g => ({ ...g, type: v as ContactType }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wybierz typ" />
                          </SelectTrigger>
                          <SelectContent>
                            {CONTACT_TYPES.map(t => (
                              <SelectItem key={t} value={t}>
                                {CONTACT_TYPE_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {showGlobal.powiat && (
                      <div className="space-y-1.5">
                        <Label htmlFor="import-global-powiat" className="text-xs">Powiat *</Label>
                        <SearchSelect
                          id="import-global-powiat"
                          value={globals.powiatId ? String(globals.powiatId) : null}
                          onChange={v =>
                            setGlobals(g => ({
                              ...g,
                              powiatId: v ? Number(v) : null,
                              gminaId: null,
                            }))
                          }
                          placeholder="Wybierz powiat"
                          options={powiaty.map(p => ({ value: String(p.id), label: p.name }))}
                        />
                      </div>
                    )}
                    {showGlobal.gmina && (
                      <div className="space-y-1.5">
                        <Label htmlFor="import-global-gmina" className="text-xs">Gmina (opcjonalnie)</Label>
                        <SearchSelect
                          id="import-global-gmina"
                          value={globals.gminaId ? String(globals.gminaId) : null}
                          onChange={v =>
                            setGlobals(g => ({ ...g, gminaId: v ? Number(v) : null }))
                          }
                          placeholder="Wybierz gminę"
                          options={globalGminyForPowiat.map(g => ({ value: String(g.id), label: g.name }))}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!requiredOk && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Aby przejść dalej, zmapuj <strong>Imię</strong> i <strong>Nazwisko</strong>{' '}
                  (lub jedno z pól <em>Imię i nazwisko</em>) oraz uzupełnij{' '}
                  <strong>Typ kontaktu</strong> i <strong>Powiat</strong> (z pliku lub globalnie).
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Wstecz
              </Button>
              <Button onClick={() => setStep('preview')} disabled={!requiredOk}>
                Podgląd
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'preview' && parsed && (
          <>
            <DialogHeader>
              <DialogTitle>Podgląd importu</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {valid.length} gotowych
                </span>
                {invalid.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 font-medium text-destructive">
                    <XCircle className="h-3.5 w-3.5" />
                    {invalid.length} z błędami (zostaną pominięte)
                  </span>
                )}
              </div>

              {hasDictFailures && (
                <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <div className="font-medium">Wartości spoza słowników</div>
                  <div className="text-xs text-muted-foreground">
                    {(Object.keys(dictFailureCounts) as DictField[])
                      .filter(f => dictFailureCounts[f] > 0)
                      .map(
                        f =>
                          `${dictFailureCounts[f]} × niepoprawna wartość pola ${DICT_LABELS[f]}`,
                      )
                      .join(' • ')}
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={applyGlobals}
                      onChange={e => setApplyGlobals(e.target.checked)}
                      className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input accent-primary"
                    />
                    <span>
                      Zastosuj wartości globalne dla nieparsowanych pól w tych wierszach
                      {!globals.type && !globals.powiatId && !globals.gminaId && (
                        <span className="ml-1 text-xs text-destructive">
                          (najpierw ustaw je w kroku mapowania)
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              )}

              <div className="max-h-72 overflow-auto rounded-lg border text-sm">
                <table className="min-w-full">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      {['Typ', 'Imię', 'Nazwisko', 'Telefon', 'Email', 'Miejscowość', 'Status'].map(
                        h => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {mapped.map((r, i) => (
                      <tr
                        key={i}
                        className={r.errors.length ? 'border-t bg-destructive/5' : 'border-t'}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {r.type ? CONTACT_TYPE_LABELS[r.type] : <em className="text-destructive">–</em>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {r.first_name || <em className="text-muted-foreground">–</em>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {r.last_name || <em className="text-muted-foreground">–</em>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                          {r.phone ?? '–'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                          {r.email ?? '–'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                          {r.miejscowosc ?? '–'}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.errors.length === 0 ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <span
                              className="flex max-w-[260px] items-center gap-1 text-xs text-destructive"
                              title={r.errors.join('; ')}
                            >
                              <XCircle className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{r.errors[0]}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('mapping')}>
                Wstecz
              </Button>
              <Button onClick={handleImport} disabled={valid.length === 0 || isPending}>
                {isPending ? 'Importowanie…' : `Importuj ${valid.length} kontaktów`}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle>Import zakończony</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <p className="text-lg font-semibold">
                Zaimportowano {result?.imported ?? 0} kontaktów
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Zamknij</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

