import { Mail, MapPin, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Office } from '@/integrations/supabase/types';
import { publicFocus } from '@/components/public/styles';
import { fullAddress, mapsHref, telHref } from '@/components/public/officeLinks';

interface Props {
  office: Pick<Office, 'address' | 'city' | 'phone' | 'email'>;
  className?: string;
}

const rowLink = cn(
  'inline-flex min-h-10 items-start gap-2.5 rounded py-2 text-sm text-foreground transition-colors hover:text-brand',
  publicFocus,
);
const rowIcon = 'mt-0.5 h-4 w-4 shrink-0 text-brand';

/** Klikalne dane kontaktowe biura: adres (mapa), telefon (`tel:`), e-mail (`mailto:`). */
export function OfficeContactList({ office, className }: Props) {
  const address = fullAddress(office);

  if (!address && !office.phone && !office.email) {
    return <p className={cn('py-2 text-sm text-muted-foreground', className)}>{office.city} · adres wkrótce</p>;
  }

  return (
    <ul className={cn('flex flex-col', className)}>
      {address && (
        <li>
          <a href={mapsHref(address)} target="_blank" rel="noopener noreferrer" className={rowLink}>
            <MapPin className={rowIcon} aria-hidden />
            <span>
              {address}
              <span className="sr-only"> - pokaż na mapie (nowa karta)</span>
            </span>
          </a>
        </li>
      )}
      {office.phone && (
        <li>
          <a href={telHref(office.phone)} className={cn(rowLink, 'font-semibold tabular-nums')}>
            <Phone className={rowIcon} aria-hidden />
            {office.phone}
          </a>
        </li>
      )}
      {office.email && (
        <li>
          <a href={`mailto:${office.email}`} className={rowLink}>
            <Mail className={rowIcon} aria-hidden />
            <span className="break-all">{office.email}</span>
          </a>
        </li>
      )}
    </ul>
  );
}
