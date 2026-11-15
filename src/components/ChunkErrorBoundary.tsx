import { Component, type ReactNode } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface State {
  hasError: boolean;
  isReloading: boolean;
}

// Klucz w sessionStorage - czyszczony po udanym załadowaniu, zapobiega
// infinite-reload loop gdy chunk naprawdę nie istnieje.
const RELOAD_GUARD = 'app_chunk_reload';

function isChunkError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
      error.message,
    )
  );
}

export class ChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, isReloading: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (!isChunkError(error)) return;

    try {
      if (!sessionStorage.getItem(RELOAD_GUARD)) {
        sessionStorage.setItem(RELOAD_GUARD, '1');
        this.setState({ isReloading: true });
        window.location.reload();
      }
    } catch {
      // sessionStorage niedostępny (np. tryb prywatny z blokowaniem) — ignoruj.
    }
  }

  componentDidMount() {
    // Jeśli komponent zamontował się poprawnie po reloadzie — kasuj guard.
    try {
      sessionStorage.removeItem(RELOAD_GUARD);
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.isReloading) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="status">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">Aktualizacja aplikacji…</p>
        </div>
      );
    }

    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center" role="alert">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CloudOff className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Nie udało się załadować strony.</p>
            <p className="text-xs text-muted-foreground">Odśwież widok, aby spróbować ponownie.</p>
          </div>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Odśwież
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
