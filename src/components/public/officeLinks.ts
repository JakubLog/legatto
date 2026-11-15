import type { Office } from '@/integrations/supabase/types';

/** Link `tel:` - same cyfry i `+`, bez spacji/myślników z zapisu numeru. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Pełny adres biura; miasto dopisywane, gdy nie ma go już w polu adresu. */
export function fullAddress(office: Pick<Office, 'address' | 'city'>): string | null {
  if (!office.address) return null;
  return office.address.includes(office.city) ? office.address : `${office.address}, ${office.city}`;
}

/** Wyszukiwanie adresu w Google Maps (działa też jako nawigacja na telefonie). */
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
