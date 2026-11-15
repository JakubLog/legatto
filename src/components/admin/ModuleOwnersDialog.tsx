import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { SearchSelect, type SearchSelectOption } from '@/components/ui/search-select';
import { CreatorAvatar } from '@/components/common/CreatorAvatar';
import { useAssignableUsers } from '@/hooks/useUsers';
import { useSetModuleOwners } from '@/hooks/useModuleOwners';
import { errorMessage } from '@/lib/errors';
import type { OwnedModuleInfo } from '@/lib/moduleOwners';
import type { ModuleOwner } from '@/integrations/supabase/types';

const NONE = '__none__';

interface Props {
  module: OwnedModuleInfo | null;
  owners: ModuleOwner[];
  onClose: () => void;
}

/** Wybór 1-2 osób odpowiedzialnych za moduł. Stan startowy z `owners` - rodzic montuje z `key` modułu. */
export function ModuleOwnersDialog({ module, owners, onClose }: Props) {
  const { data: users = [] } = useAssignableUsers();
  const setOwners = useSetModuleOwners();
  const [first, setFirst] = useState(owners[0]?.user_id ?? '');
  const [second, setSecond] = useState(owners[1]?.user_id ?? NONE);

  const activeIds = new Set(users.map((u) => u.id));
  const firstValid = activeIds.has(first);
  const secondValid = second === NONE || (activeIds.has(second) && second !== first);

  const handleSave = async () => {
    if (!module || !firstValid || !secondValid) return;
    try {
      await setOwners.mutateAsync({
        module: module.module,
        userIds: second === NONE ? [first] : [first, second],
      });
      toast.success('Zapisano osoby odpowiedzialne', { description: module.label });
      onClose();
    } catch (err) {
      toast.error('Nie udało się zapisać przypisania', { description: errorMessage(err) });
    }
  };

  const userOptions: SearchSelectOption[] = users.map((u) => ({
    value: u.id,
    label: u.full_name,
    icon: <CreatorAvatar name={u.full_name} avatarUrl={u.avatar_url} className="h-5 w-5 ring-0" />,
  }));

  return (
    <Dialog open={Boolean(module)} onOpenChange={(o) => !o && !setOwners.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{module?.label}: osoby odpowiedzialne</DialogTitle>
          <DialogDescription>Wybierz jedną lub dwie osoby odpowiedzialne za moduł.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="module-owner-1">Osoba odpowiedzialna</Label>
            <SearchSelect
              id="module-owner-1"
              value={first || null}
              onChange={(v) => {
                const next = v ?? '';
                setFirst(next);
                if (next === second) setSecond(NONE);
              }}
              placeholder="Wybierz osobę"
              options={userOptions}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="module-owner-2">Druga osoba (opcjonalnie)</Label>
            <SearchSelect
              id="module-owner-2"
              value={second === NONE ? null : second}
              onChange={(v) => setSecond(v ?? NONE)}
              noneLabel="Brak"
              placeholder="Brak"
              options={userOptions}
            />
            {second !== NONE && second === first && (
              <p className="text-xs text-destructive">Ta osoba jest już wybrana powyżej.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={setOwners.isPending}>
            Anuluj
          </Button>
          <Button onClick={handleSave} disabled={setOwners.isPending || !firstValid || !secondValid}>
            {setOwners.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
