import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, UserPen } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AvatarUploadButton } from '@/components/common/AvatarUploadButton';
import { useUpdateUser } from '@/hooks/useUsers';
import { isAdmin } from '@/lib/permissions';
import { useRoleLabel } from '@/hooks/useMpForms';
import { DEFAULT_DATA_SCOPES, type DataScopes } from '@/lib/dataScope';
import { DataScopeFields } from '@/components/admin/DataScopeFields';
import type { ProfileWithOffice } from '@/integrations/supabase/types';

const schema = z.object({
  full_name: z.string().min(2, 'Min. 2 znaki'),
  phone: z.string().optional(),
  is_public: z.boolean(),
});
type Values = z.infer<typeof schema>;

interface Props {
  user: ProfileWithOffice | null;
  onClose: () => void;
}

export function EditUserProfileDialog({ user, onClose }: Props) {
  const updateMut = useUpdateUser();
  const [scopes, setScopes] = useState<DataScopes>(DEFAULT_DATA_SCOPES);
  const roleLabel = useRoleLabel();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', phone: '', is_public: true },
  });

  useEffect(() => {
    if (!user) return;
    form.reset({
      full_name: user.full_name,
      phone: user.phone ?? '',
      is_public: user.is_public,
    });
    setScopes({
      scope_contacts: user.scope_contacts,
      scope_cases: user.scope_cases,
      scope_events: user.scope_events,
      scope_interpellations: user.scope_interpellations,
    });
  }, [user, form]);

  const onAvatarUploaded = async (url: string) => {
    if (!user) return;
    await updateMut.mutateAsync({ id: user.id, avatar_url: url });
  };

  const onAvatarRemoved = async () => {
    if (!user) return;
    await updateMut.mutateAsync({ id: user.id, avatar_url: null });
  };

  const onSubmit = async (values: Values) => {
    if (!user) return;
    try {
      await updateMut.mutateAsync({
        id: user.id,
        full_name: values.full_name.trim(),
        phone: values.phone?.trim() || null,
        is_public: values.is_public,
        ...(!isAdmin(user.role) ? scopes : {}),
      });
      toast.success('Profil użytkownika zaktualizowany');
      onClose();
    } catch (err) {
      toast.error('Błąd zapisu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const showScopes = !isAdmin(user?.role);

  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPen className="h-5 w-5 text-primary" />
            Edytuj profil użytkownika
          </DialogTitle>
          <DialogDescription className="max-md:[overflow-wrap:anywhere]">
            {user ? `${user.email} · Rola: ${roleLabel(user.role)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {user && (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AvatarUploadButton
              userId={user.id}
              fullName={user.full_name}
              currentUrl={user.avatar_url}
              onUploaded={onAvatarUploaded}
              onRemoved={onAvatarRemoved}
              cacheKey={user.updated_at}
              size="sm"
            />

            <div className="space-y-1.5">
              <Label htmlFor="full_name">Imię i nazwisko</Label>
              <Input id="full_name" {...form.register('full_name')} />
              {form.formState.errors.full_name && (
                <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefon kontaktowy</Label>
              <Input id="phone" type="tel" placeholder="+48 ..." {...form.register('phone')} />
            </div>

            <label
              htmlFor="is_public_admin"
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3"
            >
              <input
                id="is_public_admin"
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-input accent-primary"
                checked={form.watch('is_public')}
                onChange={(e) => form.setValue('is_public', e.target.checked)}
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium leading-none">
                  Widoczny na publicznej liście pracowników biura
                </span>
                <span className="block text-xs text-muted-foreground">
                  Po wyłączeniu profil zniknie ze strony publicznej.
                </span>
              </span>
            </label>

            {showScopes && <DataScopeFields value={scopes} onChange={setScopes} />}

            <DialogFooter className="-mx-6 border-t px-6 pt-4 max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
              <Button type="button" variant="outline" className="max-md:w-full" onClick={onClose}>
                Anuluj
              </Button>
              <Button type="submit" className="max-md:w-full" disabled={updateMut.isPending}>
                {updateMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Zapisz
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
