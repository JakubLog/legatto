import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ContactFormDialog } from '@/components/contacts/ContactFormDialog';
import type { CaseInput } from '@/hooks/useCases';
import type { CaseWithRelations } from '@/integrations/supabase/types';
import { CaseReporterSection } from './CaseReporterSection';
import { CASE_FORM_DEFAULTS, caseFormSchema, type CaseFormValues, type ReporterMode } from './caseFormSchema';

const reporterSchema = caseFormSchema.pick({
  contact_id: true,
  reporter_name: true,
  reporter_phone: true,
  reporter_email: true,
});

interface Props {
  case_: CaseWithRelations;
  onSave: (patch: Partial<CaseInput>) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Edycja osoby zgłaszającej w podglądzie sprawy: ta sama sekcja co w formularzu nowej sprawy
 * (kontakt z bazy albo dane ręczne), zapis jednym przyciskiem. Esc anuluje (`data-inline-edit`).
 */
export function CaseReporterEditor({ case_: c, onSave, onClose }: Props) {
  const hasManual = Boolean(c.reporter_name || c.reporter_phone || c.reporter_email);
  const [mode, setMode] = useState<ReporterMode>(!c.contact_id && hasManual ? 'manual' : 'search');
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const form = useForm<CaseFormValues>({
    defaultValues: {
      ...CASE_FORM_DEFAULTS,
      contact_id: c.contact_id ?? undefined,
      reporter_name: c.reporter_name ?? '',
      reporter_phone: c.reporter_phone ?? '',
      reporter_email: c.reporter_email ?? '',
    },
  });

  const persist = async (patch: Partial<CaseInput>) => {
    setSaving(true);
    const ok = await onSave(patch);
    setSaving(false);
    if (ok) onClose();
  };

  const submit = () => {
    form.clearErrors();
    const parsed = reporterSchema.safeParse(form.getValues());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'reporter_email') form.setError(field, { message: issue.message });
      }
      return;
    }
    const v = parsed.data;
    void persist({
      contact_id: v.contact_id ?? null,
      reporter_name: v.reporter_name?.trim() || null,
      reporter_phone: v.reporter_phone?.trim() || null,
      reporter_email: v.reporter_email?.trim() || null,
    });
  };

  return (
    <>
      <div
        className="space-y-2"
        data-inline-edit=""
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <CaseReporterSection
          form={form}
          mode={mode}
          onModeChange={setMode}
          onRemove={() =>
            void persist({ contact_id: null, reporter_name: null, reporter_phone: null, reporter_email: null })
          }
          onCreateContact={() => setCreateContactOpen(true)}
        />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="max-md:h-11" onClick={onClose} disabled={saving}>
            Anuluj
          </Button>
          <Button type="button" size="sm" className="max-md:h-11" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Zapisz
          </Button>
        </div>
      </div>

      <ContactFormDialog
        open={createContactOpen}
        onOpenChange={setCreateContactOpen}
        onCreated={(newContactId) => {
          form.setValue('contact_id', newContactId);
          setMode('search');
        }}
      />
    </>
  );
}
