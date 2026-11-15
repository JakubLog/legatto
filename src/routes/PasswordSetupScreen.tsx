import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { newPasswordSchema, passwordErrorMessage, PASSWORD_HINT, type NewPasswordValues } from '@/lib/password';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';

export function PasswordSetupScreen() {
  const { profile, passwordRecovery, refreshProfile, clearPasswordRecovery, signOut } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async (values: NewPasswordValues) => {
    if (!profile) return;
    setSubmitting(true);
    try {
      const { error: pwError } = await supabase.auth.updateUser({ password: values.password });
      if (pwError) throw pwError;

      // Polityka profiles_update_self nie pozwala self na zmiane password_set -
      // dedykowany SECURITY DEFINER RPC ustawia flage tylko dla auth.uid().
      const { error: flagError } = await supabase.rpc('mark_my_password_set');
      if (flagError) throw flagError;

      clearPasswordRecovery();
      await refreshProfile();
      toast.success('Hasło ustawione', {
        description: 'Możesz teraz korzystać z aplikacji.',
      });
    } catch (err) {
      toast.error('Nie udało się ustawić hasła', {
        description: passwordErrorMessage(err),
      });
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      footer={
        <button
          type="button"
          className="min-h-10 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void signOut()}
          disabled={submitting}
        >
          Wyloguj się i wrócić później
        </button>
      }
    >
      <AuthHeader
        icon={ShieldCheck}
        title={passwordRecovery ? 'Ustaw nowe hasło' : 'Ustaw swoje hasło'}
        description={
          passwordRecovery ? (
            'Logujesz się linkiem odzyskania hasła. Aby korzystać z systemu, ustal nowe hasło - poprzednie przestanie działać.'
          ) : (
            <>
              Witaj{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}! Aby
              korzystać z systemu, ustal własne hasło. Będzie obowiązywać przy kolejnych logowaniach.
            </>
          )
        }
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="password">Nowe hasło</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            className="h-10"
            {...form.register('password')}
          />
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
          <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Powtórz hasło</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className="h-10"
            {...form.register('confirm')}
          />
          {form.formState.errors.confirm && (
            <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>
          )}
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Zapisz hasło
        </Button>
      </form>
    </AuthLayout>
  );
}
