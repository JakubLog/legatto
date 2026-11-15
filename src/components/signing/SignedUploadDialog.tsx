import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSignature, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { FileDropZone } from '@/components/signing/FileDropZone';
import { useAttachSigned, useSignableDocuments, type AttachSignedItem } from '@/hooks/useSigningDocuments';
import { uploadSignedFile } from '@/hooks/useSigningFiles';
import { useMpForms } from '@/hooks/useMpForms';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  DETACHED_SIGNATURE_MAX_BYTES,
  SIGNED_ZIP_MAX_BYTES,
  SIGNED_ZIP_MAX_ENTRIES,
  SIGNING_ATTACH_MAX,
  SIGNING_FILE_MAX_BYTES,
  SIGNATURE_EXTENSIONS,
  currentFiles,
  fileExtension,
  formatFileSize,
  mimeForExtension,
  type SigningDocument,
} from '@/lib/signing';
import {
  MATCH_SOURCE_LABELS,
  analyzeSignedFile,
  prefixMatchesOriginal,
  rowChecks,
  type MatchRow,
  type SignedInput,
  type SignedKind,
} from '@/lib/signingMatch';
import { extractSignedZip } from '@/lib/signingZip';

const ACCEPT = [...SIGNATURE_EXTENSIONS.map((e) => `.${e}`), '.zip'].join(',');

const KIND_LABELS: Record<SignedKind, string> = {
  podpisany: 'Podpisany plik (PAdES, XAdES otaczający, CAdES, ASiC)',
  podpis_zewnetrzny: 'Podpis zewnętrzny (wysyłany obok oryginału)',
};

const CHECK_ICON = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />,
  warn: <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />,
  error: <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Otwarte ze szczegółów dokumentu: pliki bez kodu w nazwie trafiają do tego dokumentu. */
  document?: SigningDocument | null;
}

/**
 * Wgranie podpisanych plików (Poseł/administrator): pliki albo .zip, dopasowanie po nazwie, po treści
 * (PDF) albo ręczne, podgląd z kontrolami, zapis jednym `signing_attach_signed` (wszystko albo nic).
 */
export function SignedUploadDialog({ open, onOpenChange, document: preferred }: Props) {
  const { data: candidates = [], isLoading: candidatesLoading } = useSignableDocuments(open);
  const candidateOptions = useMemo<SearchSelectOption[]>(
    () => candidates.map((d) => ({ value: d.id, label: `${d.code} v${d.current_version} - ${d.title}` })),
    [candidates],
  );
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const attach = useAttachSigned();
  const mp = useMpForms();
  const busy = analyzing || progress !== null;

  useEffect(() => {
    if (open) {
      setRows([]);
      setProgress(null);
    }
  }, [open]);

  const addFiles = async (files: File[]) => {
    setAnalyzing(true);
    try {
      const inputs: SignedInput[] = [];
      for (const file of files) {
        if (fileExtension(file.name) === 'zip') {
          try {
            const entries = await extractSignedZip(file);
            for (const entry of entries) {
              const mime = mimeForExtension(fileExtension(entry.name)) ?? '';
              inputs.push({ key: crypto.randomUUID(), name: entry.name, blob: new Blob([entry.data as BlobPart], { type: mime }) });
            }
          } catch (err) {
            toast.error(errorMessage(err));
          }
        } else {
          inputs.push({ key: crypto.randomUUID(), name: file.name, blob: file });
        }
      }
      const room = SIGNING_ATTACH_MAX - rows.length;
      if (inputs.length > room) {
        toast.error(`Jednorazowo można wgrać najwyżej ${SIGNING_ATTACH_MAX} plików - pominięto ${inputs.length - Math.max(room, 0)}`);
      }
      const analyzed: MatchRow[] = [];
      for (const input of inputs.slice(0, Math.max(room, 0))) {
        analyzed.push(await analyzeSignedFile(input, candidates, preferred?.id ?? null));
      }
      setRows((prev) => [...prev, ...analyzed]);
    } catch (err) {
      toast.error('Nie udało się odczytać plików', { description: errorMessage(err) });
    } finally {
      setAnalyzing(false);
    }
  };

  const updateRow = (key: string, patch: Partial<MatchRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const pickDocument = async (row: MatchRow, documentId: string | null) => {
    updateRow(row.key, { documentId, source: documentId ? 'reczny' : null, contentMatchesOriginal: null });
    if (!documentId || row.ext !== 'pdf') return;
    const doc = candidates.find((d) => d.id === documentId);
    const { original } = doc ? currentFiles(doc) : { original: null };
    if (original?.mime_type !== 'application/pdf') return;
    const matches = await prefixMatchesOriginal(row.blob, original);
    setRows((prev) => prev.map((r) => (r.key === row.key && r.documentId === documentId ? { ...r, contentMatchesOriginal: matches } : r)));
  };

  const checksByKey = Object.fromEntries(rows.map((r) => [r.key, rowChecks(r, candidates, rows)]));
  const included = rows.filter((r) => !r.skip);
  const blocked = included.filter((r) => checksByKey[r.key].some((c) => c.level === 'error'));
  const canSubmit = included.length > 0 && blocked.length === 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const items: AttachSignedItem[] = [];
      for (let i = 0; i < included.length; i += 1) {
        const row = included[i];
        const doc = candidates.find((d) => d.id === row.documentId)!;
        setProgress(`Wgrywanie pliku ${i + 1} z ${included.length}…`);
        const file = await uploadSignedFile({
          documentId: doc.id,
          version: doc.current_version,
          kind: row.kind,
          filename: row.name,
          data: row.blob,
          sha256: row.sha256,
        });
        items.push({ document_id: doc.id, version: doc.current_version, kind: row.kind, file });
      }
      setProgress('Zapisywanie…');
      await attach.mutateAsync(items);
      toast.success(items.length > 1 ? `Wgrano podpisane dokumenty: ${items.length}` : 'Wgrano podpisany dokument');
      onOpenChange(false);
    } catch (err) {
      toast.error('Nie udało się zapisać podpisanych plików', {
        description: `${errorMessage(err)}. Żaden dokument nie został zmieniony.`,
      });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-primary" aria-hidden />
            Wgraj podpisane
          </DialogTitle>
          <DialogDescription>
            Pliki podpisane przez {mp.accusative} albo archiwum .zip. Dokument dobieramy po nazwie (np.{' '}
            <span className="font-mono">DP-000123_v1_…</span>), dla PDF także po treści; pozostałe wybierz ręcznie.
          </DialogDescription>
        </DialogHeader>

        <FileDropZone
          accept={ACCEPT}
          disabled={busy || candidatesLoading}
          onFiles={(files) => void addFiles(files)}
          hint={`${SIGNATURE_EXTENSIONS.map((e) => `.${e}`).join(' ')} albo .zip (do ${SIGNED_ZIP_MAX_ENTRIES} plików, ${formatFileSize(SIGNED_ZIP_MAX_BYTES)}). Plik do ${formatFileSize(SIGNING_FILE_MAX_BYTES)}, podpis zewnętrzny do ${formatFileSize(DETACHED_SIGNATURE_MAX_BYTES)}.`}
        />
        {(analyzing || candidatesLoading) && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {candidatesLoading ? 'Wczytywanie dokumentów…' : 'Sprawdzanie plików…'}
          </p>
        )}

        {rows.length > 0 && (
          <ul className="space-y-3" aria-label="Podgląd dopasowania">
            {rows.map((row) => {
              const checks = checksByKey[row.key];
              const supported = mimeForExtension(row.ext) !== null;
              return (
                <li key={row.key} className={cn('rounded-lg border p-3', row.skip && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={row.name}>
                      {row.name}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">{formatFileSize(row.size)}</span>
                    {row.source && !row.skip && <Badge variant="muted">{MATCH_SOURCE_LABELS[row.source]}</Badge>}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-md:min-h-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input accent-primary max-md:h-5 max-md:w-5"
                        checked={row.skip}
                        disabled={!supported || busy}
                        onChange={(e) => updateRow(row.key, { skip: e.target.checked })}
                      />
                      Pomiń
                    </label>
                  </div>

                  {supported && !row.skip && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Dokument</Label>
                        <SearchSelect
                          value={row.documentId}
                          disabled={busy}
                          onChange={(v) => void pickDocument(row, v)}
                          options={candidateOptions}
                          noneLabel="- wybierz -"
                          placeholder="Wybierz dokument"
                          aria-label={`Dokument dla ${row.name}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Rodzaj</Label>
                        {row.kindSwitchable ? (
                          <Select
                            value={row.kind}
                            disabled={busy}
                            onValueChange={(v) => updateRow(row.key, { kind: v as SignedKind })}
                          >
                            <SelectTrigger aria-label={`Rodzaj podpisu dla ${row.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(KIND_LABELS) as SignedKind[]).map((k) => (
                                <SelectItem key={k} value={k}>
                                  {KIND_LABELS[k]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="flex min-h-9 items-center text-sm">{KIND_LABELS[row.kind]}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {(!row.skip || !supported) && checks.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {checks.map((c) => (
                        <li
                          key={c.text}
                          className={cn(
                            'flex items-start gap-1.5 text-xs',
                            c.level === 'error' ? 'text-destructive' : c.level === 'warn' ? 'text-amber-700' : 'text-muted-foreground',
                          )}
                        >
                          <span className="mt-px">{CHECK_ICON[c.level]}</span>
                          {c.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <p className="mr-auto self-center text-xs text-muted-foreground" role="status">
            {progress ??
              (rows.length > 0
                ? blocked.length > 0
                  ? `Popraw albo pomiń pliki z błędami: ${blocked.length}`
                  : `Do zapisu: ${included.length} z ${rows.length}`
                : null)}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {progress !== null && <Loader2 className="animate-spin" />}
            {included.length > 1 ? `Zapisz podpisane (${included.length})` : 'Zapisz podpisany'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
