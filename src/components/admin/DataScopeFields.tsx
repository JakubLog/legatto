import { Label } from '@/components/ui/label';
import { useMpForms } from '@/hooks/useMpForms';
import { DATA_SCOPE_LABELS, SCOPE_MODULES, type DataScopes } from '@/lib/dataScope';
import { cn } from '@/lib/utils';
import type { DataScope } from '@/integrations/supabase/types';

interface Props {
  value: DataScopes;
  onChange: (next: DataScopes) => void;
}

/** Panel wyboru zakresu dostępu (own/all) per moduł - używany przy tworzeniu i edycji użytkownika. */
export function DataScopeFields({ value, onChange }: Props) {
  const mp = useMpForms();
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="space-y-0.5 border-b bg-muted/30 px-3 py-2.5">
        <Label className="text-sm font-semibold">Zakres dostępu do danych</Label>
        <p className="text-xs text-muted-foreground">
          Decyduje co użytkownik widzi na listach. {mp.nominative} i Administrator zawsze widzą wszystko.
        </p>
      </div>
      <div className="divide-y">
        {SCOPE_MODULES.map((m) => (
          <ScopeRow
            key={m.module}
            label={m.label}
            description={m.description}
            value={value[m.field]}
            onChange={(v) => onChange({ ...value, [m.field]: v })}
          />
        ))}
      </div>
    </div>
  );
}

interface ScopeRowProps {
  label: string;
  description: string;
  value: DataScope;
  onChange: (v: DataScope) => void;
}

function ScopeRow({ label, description, value, onChange }: ScopeRowProps) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="inline-flex w-full shrink-0 self-start rounded-lg bg-muted p-0.5 md:w-auto md:self-auto" role="group" aria-label={label}>
        {(['own', 'all'] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => onChange(scope)}
            aria-pressed={value === scope}
            className={cn(
              'min-h-8 flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors max-md:min-h-10 md:flex-none',
              value === scope
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {DATA_SCOPE_LABELS[scope]}
          </button>
        ))}
      </div>
    </div>
  );
}
