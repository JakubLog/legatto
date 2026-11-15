import type { ContactsFilters } from '@/hooks/useContacts';

export const EMPTY_CONTACT_FILTERS: ContactsFilters = {
  type: null,
  powiatId: null,
  gminaId: null,
  createdBy: null,
  search: '',
  newsletterConsent: null,
};

export function hasActiveContactFilters(value: ContactsFilters): boolean {
  return (
    !!value.type ||
    !!value.powiatId ||
    !!value.gminaId ||
    !!value.createdBy ||
    (value.search ?? '').length > 0 ||
    value.newsletterConsent === true
  );
}
