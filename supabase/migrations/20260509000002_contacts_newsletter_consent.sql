-- Zgoda na newsletter i synchronizacja z GetResponse dla kontaktów.
--
-- newsletter_consent: czy kontakt wyraził zgodę na newsletter (checkbox w formularzu).
-- gr_contact_id:      ID kontaktu po stronie GetResponse (ustawiany przez edge function
--                     getresponse-proxy/sync_contact via service_role).
--                     NULL = nie zsynchronizowany z GR.
--
-- Zapis gr_contact_id odbywa się przez Edge Function (service_role), nie przez klienta -
-- pole jest wyłączone z ContactInput (piszemy tylko newsletter_consent).

alter table public.contacts
  add column if not exists newsletter_consent boolean not null default false,
  add column if not exists gr_contact_id text;
