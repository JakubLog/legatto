import { useEffect, useState } from 'react';
import { FileText, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ErrorNotice, SettingsCard, SettingsCardSkeleton } from '@/components/admin/AdminUi';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageField } from '@/components/campaigns/ImageField';
import {
  useNewsletterDefaults,
  useUpdateNewsletterDefaults,
  type NewsletterDefaults,
} from '@/hooks/useNewsletterDefaults';

export function NewsletterDefaultsCard() {
  const defaultsQ = useNewsletterDefaults();
  const updateMut = useUpdateNewsletterDefaults();
  const [form, setForm] = useState<NewsletterDefaults | null>(null);

  useEffect(() => {
    if (defaultsQ.data && !form) {
      setForm(defaultsQ.data);
    }
  }, [defaultsQ.data, form]);

  const set = <K extends keyof NewsletterDefaults>(field: K, value: NewsletterDefaults[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    try {
      await updateMut.mutateAsync(form);
      toast.success('Stałe newslettera zapisane');
    } catch (err) {
      toast.error('Nie udało się zapisać stałych', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  if (defaultsQ.isLoading || !form) {
    return <SettingsCardSkeleton label="Ładuje stałe newslettera..." fields={4} />;
  }

  if (defaultsQ.error) {
    return <ErrorNotice title="Błąd odczytu stałych" message={defaultsQ.error.message} />;
  }

  return (
    <SettingsCard
      icon={FileText}
      title="Stałe newslettera"
      description={
        <>
          Wartości domyślne wstrzykiwane do każdej nowej kampanii. Uzupełnij raz — będą
          automatycznie pre-wypełniać edytor przy każdym nowym newsletterze.
        </>
      }
      footer={
        <Button onClick={handleSave} disabled={updateMut.isPending}>
          {updateMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Zapisz stałe
        </Button>
      }
    >
      <div className="space-y-6 divide-y [&>section+section]:pt-6">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground">Nagłówek</h3>
          <ImageField
            label="Avatar / zdjęcie nagłówkowe"
            value={form.header_avatar_url}
            onChange={(v) => set('header_avatar_url', v)}
            description="Zdjęcie profilowe wyświetlane w górnej belce każdego newslettera."
          />
          <div className="space-y-1.5">
            <Label htmlFor="nd-region-label">Region</Label>
            <Input
              id="nd-region-label"
              value={form.region_label}
              onChange={(e) => set('region_label', e.target.value)}
              placeholder="np. Mazowsze"
              maxLength={60}
            />
            <p className="text-xs text-muted-foreground">
              Pokazywany w nagłówku obok tytułu posła i jako nazwa sekcji regionalnej. Puste = „Z regionu”, bez regionu w nagłówku.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground">Stopka</h3>
          <div className="grid gap-3 @sm:grid-cols-2">
            <div className="space-y-1.5 @sm:col-span-2">
              <Label htmlFor="nd-office-name">Nazwa biura</Label>
              <Input
                id="nd-office-name"
                value={form.footer_office_name}
                onChange={(e) => set('footer_office_name', e.target.value)}
                placeholder="np. Biuro Poselskie Jana Kowalskiego"
              />
            </div>
            <div className="space-y-1.5 @sm:col-span-2">
              <Label htmlFor="nd-office-address">Adres biura</Label>
              <Input
                id="nd-office-address"
                value={form.footer_office_address}
                onChange={(e) => set('footer_office_address', e.target.value)}
                placeholder="np. ul. Przykładowa 1, 00-001 Warszawa"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-contact-email">Email kontaktowy</Label>
              <Input
                id="nd-contact-email"
                type="email"
                value={form.footer_contact_email}
                onChange={(e) => set('footer_contact_email', e.target.value)}
                placeholder="np. biuro@example.pl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-privacy-url">Polityka prywatności (URL)</Label>
              <Input
                id="nd-privacy-url"
                type="url"
                value={form.footer_privacy_url}
                onChange={(e) => set('footer_privacy_url', e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground">Social media (stopka)</h3>
          <div className="grid gap-3 @sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nd-social-x">X (Twitter)</Label>
              <Input
                id="nd-social-x"
                type="url"
                value={form.footer_social_x}
                onChange={(e) => set('footer_social_x', e.target.value)}
                placeholder="https://x.com/..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-social-fb">Facebook</Label>
              <Input
                id="nd-social-fb"
                type="url"
                value={form.footer_social_facebook}
                onChange={(e) => set('footer_social_facebook', e.target.value)}
                placeholder="https://facebook.com/..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-social-ig">Instagram</Label>
              <Input
                id="nd-social-ig"
                type="url"
                value={form.footer_social_instagram}
                onChange={(e) => set('footer_social_instagram', e.target.value)}
                placeholder="https://instagram.com/..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-social-tt">TikTok</Label>
              <Input
                id="nd-social-tt"
                type="url"
                value={form.footer_social_tiktok}
                onChange={(e) => set('footer_social_tiktok', e.target.value)}
                placeholder="https://tiktok.com/@..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-social-yt">YouTube</Label>
              <Input
                id="nd-social-yt"
                type="url"
                value={form.footer_social_youtube}
                onChange={(e) => set('footer_social_youtube', e.target.value)}
                placeholder="https://youtube.com/@..."
              />
            </div>
          </div>
        </section>
      </div>
    </SettingsCard>
  );
}
