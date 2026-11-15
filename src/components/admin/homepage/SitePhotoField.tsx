import { useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useUploadSiteAsset } from '@/hooks/useSiteContent';
import { cn } from '@/lib/utils';
import type { SiteContent } from '@/lib/siteContent';

import { fieldId } from './fieldId';
import { FieldMessage } from './fields';

const NAME = 'identity.photo_url' as const;
const ACCEPT = 'image/png,image/webp,image/jpeg';

/** Zdjęcie posła do hero: podgląd na ciemnym tle, upload do bucketu `site-assets`, usunięcie. */
export function SitePhotoField() {
  const { control, setValue, getFieldState, formState } = useFormContext<SiteContent>();
  const value = useWatch({ control, name: NAME });
  const { error } = getFieldState(NAME, formState);
  const uploadMut = useUploadSiteAsset();
  const inputRef = useRef<HTMLInputElement>(null);
  const [broken, setBroken] = useState(false);
  const id = fieldId(NAME);
  const uploading = uploadMut.isPending;

  const update = (url: string) => {
    setBroken(false);
    setValue(NAME, url, { shouldDirty: true, shouldValidate: true });
  };

  const handleFile = async (file: File) => {
    try {
      update(await uploadMut.mutateAsync(file));
    } catch (err) {
      toast.error('Nie udało się wgrać zdjęcia', {
        description: err instanceof Error ? err.message : 'Nieznany błąd',
      });
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Zdjęcie posła</Label>
      <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start">
        {/* Podgląd na ciemnym tle - widać, czy sylwetka jest dobrze wycięta z przezroczystego tła. */}
        <div
          className={cn(
            'relative flex h-48 w-32 shrink-0 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-b from-slate-700 to-slate-900 text-slate-300',
            error && 'ring-2 ring-destructive/60',
          )}
        >
          {uploading ? (
            <Loader2 className="mb-auto mt-auto h-6 w-6 animate-spin" aria-label="Wgrywam zdjęcie" />
          ) : value && !broken ? (
            <img src={value} alt="Podgląd zdjęcia posła" className="h-full w-full object-contain object-bottom" onError={() => setBroken(true)} />
          ) : (
            <ImagePlus className="mb-auto mt-auto h-6 w-6" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {value && (
            <p className={cn('truncate text-xs', broken ? 'text-destructive' : 'text-muted-foreground')} title={value}>
              {broken ? 'Nie można wczytać zdjęcia z tego adresu' : value.split('/').pop()}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button id={id} type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {value ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => update('')}>
                <Trash2 className="h-4 w-4" />
                Usuń
              </Button>
            )}
          </div>
          <FieldMessage
            id={id}
            error={error?.message}
            hint="Najlepiej wycięta sylwetka na przezroczystym tle (PNG lub WebP), ok. 800×1200 px, max 5 MB. Bez zdjęcia hero wyświetla sam tekst."
          />
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
