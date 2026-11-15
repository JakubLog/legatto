import { useRef, useState, type ReactNode } from 'react';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useUploadAvatar } from '@/hooks/useUsers';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

interface Props {
  userId: string;
  fullName: string;
  currentUrl: string | null;
  onUploaded: (url: string) => Promise<void> | void;
  onRemoved: () => Promise<void> | void;
  /** Wartość cache-buster URL dla aktualnie wyswietlanego avatara (np. updated_at). */
  cacheKey?: string;
  size?: 'sm' | 'lg';
  /** Opcjonalna treść nad przyciskami (np. imię, email, rola). */
  heading?: ReactNode;
}

export function AvatarUploadButton({
  userId,
  fullName,
  currentUrl,
  onUploaded,
  onRemoved,
  cacheKey,
  size = 'lg',
  heading,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const uploadMut = useUploadAvatar();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const url = await uploadMut.mutateAsync({ userId, file });
      await onUploaded(url);
      toast.success('Zdjęcie zaktualizowane');
    } catch (err) {
      toast.error('Błąd uploadu', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemoved();
      toast.success('Zdjęcie usunięte');
    } catch (err) {
      toast.error('Błąd usuwania', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    } finally {
      setRemoving(false);
    }
  };

  const avatarSize = size === 'lg' ? 'h-20 w-20 max-md:h-16 max-md:w-16' : 'h-16 w-16';
  const fallbackSize = size === 'lg' ? 'text-lg' : 'text-base';
  const displayUrl = currentUrl ? `${currentUrl}${cacheKey ? `?v=${cacheKey}` : ''}` : null;
  const busy = uploadMut.isPending || removing;

  return (
    <div className="flex items-start gap-4">
      <Avatar className={`${avatarSize} shrink-0 shadow-sm ring-2 ring-background`}>
        {displayUrl && <AvatarImage src={displayUrl} alt={fullName} className="object-cover" />}
        <AvatarFallback className={`bg-primary/10 ${fallbackSize} font-semibold text-primary`}>
          {initials(fullName)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 space-y-2">
        {heading}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFile}
        />
        <div className="flex flex-wrap items-center gap-2 max-md:gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="max-md:w-full"
          >
            {uploadMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload />}
            {currentUrl ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
          </Button>
          {currentUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={busy}
              className="max-md:w-full"
            >
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 />}
              Usuń
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">JPG / PNG / WebP, max 2 MB.</p>
      </div>
    </div>
  );
}
