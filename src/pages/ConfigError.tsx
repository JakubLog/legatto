import { ServerCrash } from 'lucide-react';

import { AuthHeader, AuthLayout } from '@/components/auth/AuthLayout';

const codeClass = 'rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground';

export default function ConfigError() {
  return (
    // Poza QueryClientProvider (brak backendu) - stały pusty podpis zamiast treści instancji.
    <AuthLayout contentClassName="max-w-xl" brandSubtitle="">
      <AuthHeader
        icon={ServerCrash}
        iconTone="destructive"
        title="Brak konfiguracji Supabase"
        description={
          <>
            Aplikacja nie ma dostępu do backendu. Utwórz plik <code className={codeClass}>.env.local</code> w
            katalogu projektu.
          </>
        }
      />
      <div className="mt-6 space-y-3 text-sm">
        <p className="text-muted-foreground">Zawartość <code className={codeClass}>.env.local</code>:</p>
        <pre className="overflow-x-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs">
{`VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
        </pre>
        <p className="text-muted-foreground">
          Klucze znajdziesz w: <strong className="font-medium text-foreground">Supabase Dashboard → Project Settings → API</strong>.
        </p>
        <p className="text-muted-foreground">
          Po zapisaniu pliku zrestartuj <code className={codeClass}>pnpm dev</code>.
        </p>
      </div>
    </AuthLayout>
  );
}
