import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { useAssignableUsers } from '@/hooks/useUsers';
import { useUpdateCase } from '@/hooks/useCases';
import { groupUsersByOffice } from '@/lib/assignableUsers.utils';
import type { CaseWithRelations } from '@/integrations/supabase/types';

interface Props {
  case_: CaseWithRelations | null;
  onClose: () => void;
}

/** Przepisanie sprawy na inną osobę - lista wszystkich aktywnych osób, pogrupowana po biurach. */
export function ReassignCaseDialog({ case_, onClose }: Props) {
  const { profile } = useAuth();
  const { data: users, isLoading } = useAssignableUsers();
  const updateCase = useUpdateCase();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(case_?.assigned_to ?? null);
  }, [case_?.id, case_?.assigned_to]);

  const options = useMemo<SearchSelectOption[]>(
    () =>
      groupUsersByOffice(users ?? [], profile?.office_id, '').flatMap((g) => {
        const group = g.key === profile?.office_id ? `${g.label} · moje biuro` : g.label;
        return g.users.map((u) => ({
          value: u.id,
          label: u.full_name,
          description: u.id === case_?.assigned_to ? 'obecnie przypisana' : undefined,
          icon: <CreatorAvatar name={u.full_name} avatarUrl={u.avatar_url} className="h-5 w-5 ring-0" />,
          group,
        }));
      }),
    [users, profile?.office_id, case_?.assigned_to],
  );

  const unchanged = selected === (case_?.assigned_to ?? null);

  const onSubmit = async () => {
    if (!case_ || unchanged || !selected) return;
    try {
      await updateCase.mutateAsync({ id: case_.id, assigned_to: selected });
      const name = users?.find((u) => u.id === selected)?.full_name;
      toast.success(name ? `Sprawa przepisana na: ${name}` : 'Sprawa przepisana');
      onClose();
    } catch {
      toast.error('Nie udało się przepisać sprawy');
    }
  };

  return (
    <Dialog open={Boolean(case_)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Przepisz sprawę</DialogTitle>
          <DialogDescription className="line-clamp-2">{case_?.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="reassign_case_user">Osoba</Label>
          {isLoading ? (
            <Skeleton className="h-9 max-md:h-11" />
          ) : (
            <SearchSelect
              id="reassign_case_user"
              value={selected}
              onChange={setSelected}
              options={options}
              placeholder="Wybierz osobę"
              emptyText="Brak pasujących osób."
            />
          )}
        </div>

        <DialogFooter className="-mx-6 border-t px-6 pt-4 max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
          <Button type="button" variant="outline" className="max-md:w-full" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            type="button"
            className="max-md:w-full"
            disabled={unchanged || !selected || updateCase.isPending}
            onClick={onSubmit}
          >
            {updateCase.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Przepisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
