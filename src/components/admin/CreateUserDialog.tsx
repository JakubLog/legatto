import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchSelect } from '@/components/ui/search-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { poselOnlyHint, useCreateUser } from '@/hooks/useUsers';
import { useMpForms } from '@/hooks/useMpForms';
import { isAdmin } from '@/lib/permissions';
import { DEFAULT_DATA_SCOPES, type DataScopes } from '@/lib/dataScope';
import { DataScopeFields } from '@/components/admin/DataScopeFields';
import type { AppRole, Office } from '@/integrations/supabase/types';

const NO_OFFICE = '__none__';

const createSchema = z
  .object({
    email: z.string().email('Nieprawidłowy email'),
    full_name: z.string().min(2, 'Min. 2 znaki'),
    role: z.enum(['posel', 'administrator', 'pracownik', 'asystent']),
    office_id: z.string().optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (!isAdmin(val.role) && (!val.office_id || val.office_id === NO_OFFICE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['office_id'],
        message: 'Pracownik i Asystent muszą być przypisani do biura',
      });
    }
  });
type CreateValues = z.infer<typeof createSchema>;

interface Props {
  offices: Office[] | undefined;
  /** Czy zalogowany może zakładać konta Posłów (tylko rola 'posel'; Administrator nie). */
  canManagePosel: boolean;
}

/** Przycisk "Dodaj osobę" + dialog zaproszenia nowego użytkownika. */
export function CreateUserDialog({ offices, canManagePosel }: Props) {
  const createUser = useCreateUser();
  const mp = useMpForms();
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<DataScopes>(DEFAULT_DATA_SCOPES);
  const hasOffices = (offices?.length ?? 0) > 0;

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: '', full_name: '', role: 'asystent', office_id: NO_OFFICE },
  });
  const watchedRole = form.watch('role');
  const officeOptional = isAdmin(watchedRole);

  const onCreate = async (values: CreateValues) => {
    if (values.role === 'posel' && !canManagePosel) {
      toast.error('Brak uprawnień', { description: poselOnlyHint(mp) });
      return;
    }
    try {
      await createUser.mutateAsync({
        email: values.email,
        full_name: values.full_name,
        role: values.role,
        office_id: isAdmin(values.role)
          ? (values.office_id && values.office_id !== NO_OFFICE ? values.office_id : null)
          : (values.office_id as string),
        // Poseł i Administrator zawsze widzą wszystko - zakres dotyczy tylko pozostałych ról.
        ...(!isAdmin(values.role) ? scopes : {}),
      });
      toast.success('Wysłano zaproszenie', { description: `Email do ${values.email}.` });
      form.reset({ email: '', full_name: '', role: 'asystent', office_id: NO_OFFICE });
      setScopes(DEFAULT_DATA_SCOPES);
      setOpen(false);
    } catch (err) {
      toast.error('Nie udało się utworzyć użytkownika', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus />Dodaj osobę</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Nowy użytkownik
          </DialogTitle>
          <DialogDescription>
            Na podany email zostanie wysłane zaproszenie z linkiem do ustawienia hasła.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Imię i nazwisko</Label>
            <Input id="full_name" {...form.register('full_name')} />
            {form.formState.errors.full_name && (
              <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="off" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Rola</Label>
            <Select
              value={form.watch('role')}
              onValueChange={(v) => form.setValue('role', v as AppRole, { shouldValidate: true })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="asystent">Asystent (read-only)</SelectItem>
                <SelectItem value="pracownik">Pracownik (write)</SelectItem>
                {canManagePosel && <SelectItem value="posel">{mp.nominative} (admin)</SelectItem>}
                <SelectItem value="administrator">Administrator (admin)</SelectItem>
              </SelectContent>
            </Select>
            {!canManagePosel && (
              <p className="text-xs text-muted-foreground">{poselOnlyHint(mp)}</p>
            )}
          </div>
          {!officeOptional && (
            <div className="space-y-1.5">
              <Label htmlFor="create-user-office">Biuro</Label>
              {hasOffices ? (
                <SearchSelect
                  id="create-user-office"
                  // Wartość-wartownik NO_OFFICE nie ma pozycji na tej liście - pusta wartość pokazuje placeholder.
                  value={form.watch('office_id') === NO_OFFICE ? null : form.watch('office_id')}
                  onChange={(v) => form.setValue('office_id', v ?? NO_OFFICE, { shouldValidate: true })}
                  placeholder="Wybierz biuro..."
                  aria-invalid={!!form.formState.errors.office_id}
                  options={(offices ?? []).map((o) => ({
                    value: o.id,
                    label: `${o.name}${o.is_main ? ' (główne)' : ''} — ${o.city}`,
                  }))}
                />
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                  Brak biur.{' '}
                  <Link to="/biuro/admin/biura" className="font-medium underline max-md:inline-flex max-md:min-h-10 max-md:items-center" onClick={() => setOpen(false)}>
                    Utwórz pierwsze biuro
                  </Link>.
                </div>
              )}
              {form.formState.errors.office_id && (
                <p className="text-xs text-destructive">{form.formState.errors.office_id.message}</p>
              )}
            </div>
          )}
          {officeOptional && hasOffices && (
            <div className="space-y-1.5">
              <Label htmlFor="create-user-office-optional">Biuro (opcjonalne)</Label>
              <SearchSelect
                id="create-user-office-optional"
                value={form.watch('office_id') === NO_OFFICE ? null : form.watch('office_id')}
                onChange={(v) => form.setValue('office_id', v ?? NO_OFFICE, { shouldValidate: true })}
                noneLabel="Bez biura"
                placeholder="Bez biura"
                options={(offices ?? []).map((o) => ({ value: o.id, label: `${o.name} — ${o.city}` }))}
              />
            </div>
          )}
          {!officeOptional && <DataScopeFields value={scopes} onChange={setScopes} />}
          <DialogFooter className="-mx-6 border-t px-6 pt-4 max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
            <Button type="button" variant="outline" className="max-md:w-full" onClick={() => setOpen(false)}>Anuluj</Button>
            <Button type="submit" className="max-md:w-full" disabled={createUser.isPending || (!officeOptional && !hasOffices)}>
              {createUser.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Wyślij zaproszenie
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
