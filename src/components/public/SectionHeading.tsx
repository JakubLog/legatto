import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { publicH2, publicKicker } from '@/components/public/styles';

interface Props {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Id nagłówka - do `aria-labelledby` sekcji. */
  id?: string;
  className?: string;
}

/** Nagłówek sekcji publicznej: opcjonalny czerwony nadtytuł, tytuł h2 i opcjonalny lead. */
export function SectionHeading({ kicker, title, description, id, className }: Props) {
  return (
    <div className={cn('max-w-2xl', className)}>
      {kicker && <p className={cn(publicKicker, 'mb-3')}>{kicker}</p>}
      <h2 id={id} className={publicH2}>
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-[17px]">{description}</p>
      )}
    </div>
  );
}
