import { describe, expect, it } from 'vitest';
import { errorSummary } from './log-safe';

const EMAIL = 'jan.kowalski@example.pl';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.sekret';

describe('errorSummary (Edge Functions)', () => {
  it('błąd PostgREST z e-mailem w details: tylko kod, bez wartości wiersza', () => {
    const summary = errorSummary({
      message: 'duplicate key value violates unique constraint "contacts_email_key"',
      details: `Key (email)=(${EMAIL}) already exists.`,
      hint: null,
      code: '23505',
    });
    expect(summary).toEqual({ name: 'object', code: '23505' });
    expect(JSON.stringify(summary)).not.toContain(EMAIL);
  });

  it('błąd fetch z URL z tokenem: bez URL', () => {
    const err = new TypeError(`error sending request for url (https://api.getresponse.com/v3/contacts?token=${TOKEN})`);
    const summary = errorSummary(err);
    expect(summary).toEqual({ name: 'TypeError' });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  });

  it('AuthApiError: nazwa, kod i status', () => {
    const err = Object.assign(new Error(`User ${EMAIL} already registered`), { name: 'AuthApiError', status: 422, code: 'email_exists' });
    expect(errorSummary(err)).toEqual({ name: 'AuthApiError', code: 'email_exists', status: 422 });
  });
});
