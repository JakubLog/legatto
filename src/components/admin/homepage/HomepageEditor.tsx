import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, CircleDot, Loader2, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useUpdateSiteContent } from '@/hooks/useSiteContent';
import { homepageSchema, siteIdentitySchema, type SiteContent } from '@/lib/siteContent';

import { AppearanceCard } from './AppearanceCard';
import { FooterSeoCard } from './FooterSeoCard';
import { HeroCard } from './HeroCard';
import { IdentityCard } from './IdentityCard';
import { NavigationCard } from './NavigationCard';
import { SectionsCard } from './SectionsCard';

const siteContentFormSchema = z.object({ identity: siteIdentitySchema, homepage: homepageSchema });

/** Formularz całej treści strony publicznej - jeden zapis obu kluczy app_settings. */
export function HomepageEditor({ initial }: { initial: SiteContent }) {
  const updateMut = useUpdateSiteContent();
  const form = useForm<SiteContent>({
    resolver: zodResolver(siteContentFormSchema),
    defaultValues: initial,
  });
  const { isDirty } = form.formState;

  // Świeże dane z serwera (np. po zapisie w innej karcie) - tylko gdy nie ma lokalnych zmian.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(initial);
  }, [form, initial]);

  const onSubmit = async (values: SiteContent) => {
    try {
      await updateMut.mutateAsync(values);
      form.reset(values);
      toast.success('Strona główna zapisana');
    } catch (err) {
      toast.error('Nie udało się zapisać strony głównej', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const onInvalid = () => {
    toast.error('Popraw zaznaczone pola', { description: 'Formularz zawiera błędy - zmiany nie zostały zapisane.' });
  };

  const saving = updateMut.isPending;

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-4">
        <IdentityCard />
        <AppearanceCard />
        <HeroCard />
        <SectionsCard />
        <NavigationCard />
        <FooterSeoCard />

        {/* Pasek zapisu przyklejony do dołu obszaru modułu. #app-main ma już dolny padding
            pod dolną nawigację (sticky liczy się od krawędzi treści), więc bez dodatkowego offsetu. */}
        <div className="sticky bottom-2 z-30 -mx-1 md:bottom-4">
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-card backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" role="status">
              {isDirty ? (
                <>
                  <CircleDot className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                  Niezapisane zmiany
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                  Wszystkie zmiany zapisane
                </>
              )}
            </p>
            <div className="flex shrink-0 gap-2">
              {/* Wąsko sama ikona (etykieta dla czytników i w dymku), żeby pasek mieścił się w jednym wierszu. */}
              <Button
                type="button"
                variant="ghost"
                disabled={!isDirty || saving}
                onClick={() => form.reset()}
                title="Cofnij zmiany"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="@max-sm:sr-only">Cofnij zmiany</span>
              </Button>
              <Button type="submit" disabled={!isDirty || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Zapisz
              </Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
