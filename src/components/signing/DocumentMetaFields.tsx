import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { useCase, useCases } from '@/hooks/useCases';
import { useMpForms } from '@/hooks/useMpForms';
import {
  SIGNING_DESCRIPTION_MAX,
  SIGNING_RECIPIENT_NAME_MAX,
  SIGNING_SEND_SUBJECT_MAX,
  SIGNING_SEND_TEXT_MAX,
} from '@/lib/signing';

export interface DocumentMetaValues {
  description: string;
  recipient_name: string;
  case_id: string | null;
  /** YYYY-MM-DD albo ''. */
  due_date: string;
  send_subject: string;
  send_text: string;
}

export const EMPTY_DOCUMENT_META: DocumentMetaValues = {
  description: '',
  recipient_name: '',
  case_id: null,
  due_date: '',
  send_subject: '',
  send_text: '',
};

/** Pola do RPC: puste teksty jako null. */
export function documentMetaPayload(values: DocumentMetaValues) {
  const text = (v: string) => v.trim() || null;
  return {
    description: text(values.description),
    recipient_name: text(values.recipient_name),
    case_id: values.case_id,
    due_date: values.due_date || null,
    send_subject: text(values.send_subject),
    send_text: text(values.send_text),
  };
}

const SECTION_TITLE = 'text-xs font-semibold text-muted-foreground';

interface Props {
  idPrefix: string;
  values: DocumentMetaValues;
  onChange: (patch: Partial<DocumentMetaValues>) => void;
  disabled?: boolean;
}

/** Wspólne pola dokumentu: notatka, adresat, sprawa, termin, temat i treść do wysyłki. */
export function DocumentMetaFields({ idPrefix, values, onChange, disabled }: Props) {
  const [caseSearch, setCaseSearch] = useState('');
  const casesQ = useCases({ search: caseSearch });
  const cases = useMemo(() => casesQ.data ?? [], [casesQ.data]);
  const caseOptions = useMemo<SearchSelectOption[]>(
    () => cases.map((c) => ({ value: c.id, label: c.title })),
    [cases],
  );
  const linkedMissing = values.case_id !== null && !cases.some((c) => c.id === values.case_id);
  const { data: linkedCase } = useCase(linkedMissing ? values.case_id : null);
  // Powiązana sprawa spoza bieżących wyników (starsza niż 200 najnowszych albo spoza wyszukiwania).
  const linkedOption: SearchSelectOption | null =
    linkedMissing && values.case_id
      ? { value: values.case_id, label: linkedCase?.title ?? 'Powiązana sprawa' }
      : null;
  const mp = useMpForms();
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor={id('description')}>Notatka dla {mp.genitive}</Label>
        <Textarea
          id={id('description')}
          rows={2}
          maxLength={SIGNING_DESCRIPTION_MAX}
          value={values.description}
          disabled={disabled}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className="space-y-3">
        <h3 className={SECTION_TITLE}>Adresat</h3>
        <div className="space-y-1.5">
          <Label htmlFor={id('recipient-name')}>Nazwa adresata</Label>
          <Input
            id={id('recipient-name')}
            maxLength={SIGNING_RECIPIENT_NAME_MAX}
            value={values.recipient_name}
            disabled={disabled}
            placeholder="np. Urząd Wojewódzki"
            onChange={(e) => onChange({ recipient_name: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={id('case')}>Powiązana sprawa</Label>
          <SearchSelect
            id={id('case')}
            value={values.case_id}
            disabled={disabled}
            onChange={(v) => onChange({ case_id: v })}
            options={caseOptions}
            selectedOption={linkedOption}
            onSearchChange={setCaseSearch}
            loading={casesQ.isFetching}
            noneLabel="- brak -"
            placeholder="Brak"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('due-date')}>Termin</Label>
          <Input
            id={id('due-date')}
            type="date"
            value={values.due_date}
            disabled={disabled}
            onChange={(e) => onChange({ due_date: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className={SECTION_TITLE}>Do wysyłki</h3>
        <div className="space-y-1.5">
          <Label htmlFor={id('send-subject')}>Temat</Label>
          <Input
            id={id('send-subject')}
            maxLength={SIGNING_SEND_SUBJECT_MAX}
            value={values.send_subject}
            disabled={disabled}
            onChange={(e) => onChange({ send_subject: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('send-text')}>Treść wiadomości</Label>
          <Textarea
            id={id('send-text')}
            rows={4}
            maxLength={SIGNING_SEND_TEXT_MAX}
            value={values.send_text}
            disabled={disabled}
            onChange={(e) => onChange({ send_text: e.target.value })}
          />
          <p
            className={`text-right text-xs tabular-nums ${values.send_text.length >= SIGNING_SEND_TEXT_MAX ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {values.send_text.length}/{SIGNING_SEND_TEXT_MAX}
          </p>
        </div>
      </div>
    </div>
  );
}
