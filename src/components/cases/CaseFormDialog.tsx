import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodFormResolver } from '@/lib/zodForm';
import { Flag, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchSelect } from '@/components/ui/search-select';
import { Separator } from '@/components/ui/separator';

import {
  CASE_PRIORITIES,
  CASE_PRIORITY_FLAG,
  CASE_PRIORITY_LABELS,
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  isCaseResolved,
} from '@/lib/cases';
import { useCaseCategories } from '@/hooks/useCaseCategories';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useCreateCase, type CaseInput } from '@/hooks/useCases';
import { useUploadCaseAttachment } from '@/hooks/useCaseAttachments';
import type { CasePriority, CaseStatus } from '@/integrations/supabase/types';
import { AddCategoryDialog } from './AddCategoryDialog';
import { CaseStatusDot } from './CaseBadges';
import { CaseFormPropertyBar } from './CaseFormPropertyBar';
import { CaseReporterSection } from './CaseReporterSection';
import { PendingAttachmentsPicker } from './PendingAttachmentsPicker';
import {
  CASE_FORM_DEFAULTS,
  caseFormSchema,
  type CaseFormValues,
  type ReporterMode,
} from './caseFormSchema';
import { ContactFormDialog } from '@/components/contacts/ContactFormDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ADD_CHIP = 'h-8 rounded-full border-dashed text-muted-foreground shadow-none hover:text-foreground';

/** Nowa sprawa. Istniejącą sprawę edytuje się w miejscu w podglądzie (`CaseDetailsDialog`). */
export function CaseFormDialog({ open, onOpenChange }: Props) {
  const { profile } = useAuth();
  const { data: categories } = useCaseCategories();
  const createMut = useCreateCase();
  const uploadAttachmentMut = useUploadCaseAttachment();

  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [reporterOpen, setReporterOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [reporterMode, setReporterMode] = useState<ReporterMode>('search');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const form = useForm<CaseFormValues>({
    resolver: zodFormResolver(caseFormSchema),
    defaultValues: CASE_FORM_DEFAULTS,
  });

  const status = form.watch('status');
  const priority = form.watch('priority');
  const categoryId = form.watch('category_id');

  const submitting = createMut.isPending;

  useEffect(() => {
    if (!open) return;
    form.reset({ ...CASE_FORM_DEFAULTS, assigned_to: profile?.id ?? undefined });
    setDescriptionOpen(false);
    setReporterOpen(false);
    setReporterMode('search');
    setLocationOpen(false);
    setPendingFiles([]);
  }, [open, form, profile?.id]);

  const onSubmit = async (values: CaseFormValues) => {
    const payload: CaseInput = {
      title: values.title.trim(),
      description: values.description?.trim() || null,
      status: values.status,
      priority: values.priority,
      category_id: values.category_id,
      contact_id: values.contact_id ?? null,
      reporter_name: values.reporter_name?.trim() || null,
      reporter_phone: values.reporter_phone?.trim() || null,
      reporter_email: values.reporter_email?.trim() || null,
      powiat_id: values.powiat_id ?? null,
      gmina_id: values.gmina_id ?? null,
      assigned_to: values.assigned_to ?? null,
      due_date: values.due_date?.trim() || null,
      resolution_notes: values.resolution_notes?.trim() || null,
    };

    try {
      const created = await createMut.mutateAsync(payload);
      toast.success('Sprawa dodana');

      if (pendingFiles.length > 0) {
        let failed = 0;
        for (const file of pendingFiles) {
          try {
            await uploadAttachmentMut.mutateAsync({ caseId: created.id, file });
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          toast.error(
            `Nie udało się wgrać ${failed} z ${pendingFiles.length} załączników`,
            { description: 'Sprawa została zapisana - brakujące załączniki dodaj w podglądzie sprawy.' },
          );
        } else {
          toast.success(
            pendingFiles.length === 1
              ? 'Załącznik wgrany'
              : `Wgrano ${pendingFiles.length} załączników`,
          );
        }
      }
      onOpenChange(false);
    } catch (err) {
      toast.error('Błąd zapisu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const removeReporter = () => {
    form.setValue('contact_id', undefined);
    form.setValue('reporter_name', '');
    form.setValue('reporter_phone', '');
    form.setValue('reporter_email', '');
    setReporterMode('search');
    setReporterOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] gap-5 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Nowa sprawa wyborcy</DialogTitle>
            <DialogDescription>Opisz problem i uzupełnij wymagane pola.</DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="title">Tytuł *</Label>
              <Input
                id="title"
                className="h-10 text-base font-medium"
                placeholder="Krótki opis problemu"
                {...form.register('title')}
              />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            <CaseFormPropertyBar
              form={form}
              locationOpen={locationOpen}
              onLocationOpenChange={setLocationOpen}
            />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) =>
                    form.setValue('status', v as CaseStatus, { shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CASE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          <CaseStatusDot status={s} />
                          {CASE_STATUS_LABELS[s]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priorytet</Label>
                <Select
                  value={priority}
                  onValueChange={(v) =>
                    form.setValue('priority', v as CasePriority, { shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CASE_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        <span className="flex items-center gap-2">
                          <Flag
                            aria-hidden
                            className={cn(
                              'h-3.5 w-3.5',
                              CASE_PRIORITY_FLAG[p],
                              p !== 'low' && 'fill-current',
                            )}
                          />
                          {CASE_PRIORITY_LABELS[p]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="case-form-category">Kategoria *</Label>
                <div className="flex gap-2">
                  <SearchSelect
                    id="case-form-category"
                    value={categoryId ? String(categoryId) : null}
                    onChange={(v) => v && form.setValue('category_id', Number(v), { shouldValidate: true })}
                    options={(categories ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                    placeholder="Wybierz"
                    aria-invalid={Boolean(form.formState.errors.category_id)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setAddCategoryOpen(true)}
                    aria-label="Dodaj kategorię"
                    title="Dodaj kategorię"
                  >
                    <Plus />
                  </Button>
                </div>
                {form.formState.errors.category_id && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.category_id.message}
                  </p>
                )}
              </div>
            </div>

            {descriptionOpen && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description">Opis sprawy</Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground max-md:-my-2 max-md:-mr-2 max-md:min-h-10 max-md:px-2 max-md:text-sm"
                    onClick={() => {
                      form.setValue('description', '');
                      setDescriptionOpen(false);
                    }}
                  >
                    Usuń opis
                  </button>
                </div>
                <Textarea
                  id="description"
                  rows={4}
                  placeholder="Co konkretnie się stało? Jaki jest oczekiwany rezultat?"
                  {...form.register('description')}
                />
              </div>
            )}

            {reporterOpen && (
              <CaseReporterSection
                form={form}
                mode={reporterMode}
                onModeChange={setReporterMode}
                onRemove={removeReporter}
                onCreateContact={() => setCreateContactOpen(true)}
              />
            )}

            {(!descriptionOpen || !reporterOpen) && (
              <div className="flex flex-wrap gap-2 max-md:gap-3">
                {!descriptionOpen && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={ADD_CHIP}
                    onClick={() => {
                      setDescriptionOpen(true);
                      // Fokus tylko po kliknięciu: autoFocus przy edycji sprawy z opisem przewijał formularz
                      // do opisu (i otwierał klawiaturę na telefonie) zamiast pokazać go od tytułu.
                      setTimeout(() => form.setFocus('description'));
                    }}
                  >
                    <Plus />
                    Opis sprawy
                  </Button>
                )}
                {!reporterOpen && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={ADD_CHIP}
                    onClick={() => setReporterOpen(true)}
                  >
                    <Plus />
                    Osoba zgłaszająca
                  </Button>
                )}
              </div>
            )}

            {isCaseResolved(status) && (
              <div className="space-y-1.5">
                <Label htmlFor="resolution_notes">Notatki rozwiązania</Label>
                <Textarea
                  id="resolution_notes"
                  rows={3}
                  placeholder="Opisz krótko jak sprawa została załatwiona / odrzucona"
                  {...form.register('resolution_notes')}
                />
              </div>
            )}

            <Separator />
            <PendingAttachmentsPicker
              files={pendingFiles}
              onAdd={(file) => setPendingFiles((prev) => [...prev, file])}
              onRemove={(idx) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
              disabled={submitting}
            />

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Anuluj
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Dodaj sprawę
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AddCategoryDialog
        open={addCategoryOpen}
        onOpenChange={setAddCategoryOpen}
        onCreated={(created) => form.setValue('category_id', created.id, { shouldValidate: true })}
      />

      <ContactFormDialog
        open={createContactOpen}
        onOpenChange={setCreateContactOpen}
        onCreated={(newContactId) => {
          form.setValue('contact_id', newContactId);
          setReporterMode('search');
        }}
      />
    </>
  );
}
