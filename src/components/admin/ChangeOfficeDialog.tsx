import { useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchSelect } from '@/components/ui/search-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { isAdmin } from '@/lib/permissions';
import { useRoleLabel } from '@/hooks/useMpForms';
import type { ProfileWithOffice } from '@/integrations/supabase/types';

const NO_OFFICE = '__none__';

interface Props {
  user: ProfileWithOffice | null;
  offices: { id: string; name: string; city: string; is_main: boolean }[];
  onClose: () => void;
  onSubmit: (officeId: string | null) => Promise<void>;
}

export function ChangeOfficeDialog({ user, offices, onClose, onSubmit }: Props) {
  const [value, setValue] = useState<string>(user?.office_id ?? NO_OFFICE);
  const [submitting, setSubmitting] = useState(false);
  const roleLabel = useRoleLabel();
  return (
    <Dialog open={!!user} onOpenChange={(open) => { if (!open) { setValue(NO_OFFICE); onClose(); } }}>
      {user && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Zmień biuro
            </DialogTitle>
            <DialogDescription>
              {user.full_name} ({roleLabel(user.role)})
              {isAdmin(user.role) && ` — ${roleLabel(user.role)} może być bez biura.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="change-office">Biuro</Label>
            <SearchSelect
              id="change-office"
              value={value === NO_OFFICE ? null : value}
              onChange={(v) => setValue(v ?? NO_OFFICE)}
              noneLabel={isAdmin(user.role) ? 'Bez biura' : undefined}
              placeholder="Wybierz biuro..."
              options={offices.map((o) => ({
                value: o.id,
                label: `${o.name}${o.is_main ? ' (główne)' : ''} — ${o.city}`,
              }))}
            />
          </div>
          <DialogFooter className="max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            <Button variant="outline" className="max-md:w-full" onClick={onClose}>Anuluj</Button>
            <Button className="max-md:w-full" disabled={submitting} onClick={async () => {
              setSubmitting(true);
              await onSubmit(value === NO_OFFICE ? null : value);
              setSubmitting(false);
            }}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}Zapisz
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
