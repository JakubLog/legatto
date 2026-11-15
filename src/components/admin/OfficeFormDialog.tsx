import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { Office } from '@/integrations/supabase/types';

const officeSchema = z.object({
  name: z.string().min(2, 'Min. 2 znaki'),
  city: z.string().min(2, 'Min. 2 znaki'),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Nieprawidłowy email').optional().or(z.literal('')),
  is_main: z.boolean().optional(),
});
export type OfficeValues = z.infer<typeof officeSchema>;

interface Props {
  mode: 'create' | 'edit';
  initial?: Office;
  submitting: boolean;
  onSubmit: (values: OfficeValues) => Promise<void>;
  onCancel: () => void;
}

/** Treść dialogu tworzenia/edycji biura (renderowana wewnątrz <Dialog>). */
export function OfficeFormDialog({ mode, initial, submitting, onSubmit, onCancel }: Props) {
  const form = useForm<OfficeValues>({
    resolver: zodResolver(officeSchema),
    defaultValues: {
      name: initial?.name ?? '',
      city: initial?.city ?? '',
      address: initial?.address ?? '',
      phone: initial?.phone ?? '',
      email: initial?.email ?? '',
      is_main: initial?.is_main ?? false,
    },
  });

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          {mode === 'create' ? 'Nowe biuro' : 'Edytuj biuro'}
        </DialogTitle>
        <DialogDescription>
          Dane biura widoczne w aplikacji. Pole "biuro główne" może mieć tylko jedno biuro.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nazwa</Label>
            <Input id="name" placeholder="np. Biuro Kraków" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="city">Miasto</Label>
            <Input id="city" placeholder="np. Kraków" {...form.register('city')} />
            {form.formState.errors.city && (
              <p className="text-xs text-destructive">{form.formState.errors.city.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address">Adres (opcjonalny)</Label>
          <Input id="address" placeholder="ul. ..." {...form.register('address')} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefon (opcjonalny)</Label>
            <Input id="phone" {...form.register('phone')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (opcjonalny)</Label>
            <Input id="email" type="email" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
        </div>

        <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm max-md:min-h-11">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary max-md:h-5 max-md:w-5"
            {...form.register('is_main')}
          />
          Oznacz jako biuro główne
        </label>

        <DialogFooter className="max-md:!flex-col-reverse max-md:!gap-3 max-md:!space-x-0">
          <Button type="button" variant="outline" className="max-md:w-full" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="submit" className="max-md:w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Dodaj biuro' : 'Zapisz zmiany'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
