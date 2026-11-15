import { useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  initial: string;
  label: string;
  placeholder?: string;
  /** Zapis przyciętej wartości (pusta = wyczyszczenie pola); `true` zamyka edytor. */
  onSave: (value: string) => Promise<boolean>;
  onCancel: () => void;
}

/**
 * Pole wielowierszowe edycji w miejscu: rośnie z treścią, Ctrl/⌘+Enter zapisuje, Esc anuluje
 * (`data-inline-edit` - podgląd sprawy nie zamyka się wtedy na Esc).
 */
export function CaseInlineEditor({ initial, label, placeholder, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const submit = async () => {
    if (saving) return;
    if (value.trim() === initial.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    const ok = await onSave(value.trim());
    setSaving(false);
    if (!ok) ref.current?.focus();
  };

  return (
    <div className="space-y-2" data-inline-edit="">
      <Textarea
        ref={ref}
        aria-label={label}
        rows={3}
        value={value}
        placeholder={placeholder}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className="resize-none overflow-y-auto leading-relaxed"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="max-md:h-11" onClick={onCancel} disabled={saving}>
          Anuluj
        </Button>
        <Button type="button" size="sm" className="max-md:h-11" onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Zapisz
        </Button>
      </div>
    </div>
  );
}
