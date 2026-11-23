import { describe, expect, it } from 'vitest';

import { renderNewsletter } from './render';
import { DEFAULT_TEMPLATE, type NewsletterTemplate } from './types';

const identity = { mp_name: 'Jan Kowalski', mp_title: '', mp_gender: 'm' as const };
const SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const STORAGE_URL = `https://app.example.pl/storage/v1/object/public/newsletter-assets/7d9f6a5e-1111-4222-8333-944455556666/${SHA}.jpg`;
const LEGACY_URL = 'https://app.example.pl/storage/v1/object/public/newsletter-assets/u/1700000000000-foto.jpg';

const template: NewsletterTemplate = {
  ...DEFAULT_TEMPLATE,
  subject: 'Test',
  sections: ['lead', 'gallery'],
  header: { ...DEFAULT_TEMPLATE.header, avatar_url: STORAGE_URL },
  lead: { ...DEFAULT_TEMPLATE.lead, title: 'Temat', image_url: STORAGE_URL },
  gallery: { ...DEFAULT_TEMPLATE.gallery, images: [{ url: LEGACY_URL }] },
};

describe('renderNewsletter ze stroną posła', () => {
  const site = 'https://jan-kowalski.pl';

  it('mail: czcionka i obrazy sha256 ze strony posła, starsze obrazy bez zmian', () => {
    const html = renderNewsletter(template, { identity, publicSiteUrl: site, webUrl: `${site}/n/abcdefghijklmnop` });
    expect(html).toContain(`url('${site}/fonts/newsletter/source-sans-3-latin-wght-normal.woff2')`);
    expect(html).toContain(`src="${site}/n/a/${SHA}.jpg"`);
    expect(html).not.toContain(`newsletter-assets/7d9f6a5e`);
    expect(html).toContain(LEGACY_URL);
  });

  it('wersja online: względna czcionka, obrazy /n/a/ (generator kopiuje je z bucketu)', () => {
    const html = renderNewsletter(template, { identity, mode: 'web', publicSiteUrl: `${site}/` });
    expect(html).toContain(`url('/fonts/newsletter/`);
    expect(html).toContain(`${site}/n/a/${SHA}.jpg`);
  });

  it('wersja online bez strony posła zostaje przy URL-ach Storage', () => {
    const html = renderNewsletter(template, { identity, mode: 'web' });
    expect(html).toContain(STORAGE_URL);
    expect(html).not.toContain('/n/a/');
  });
});
