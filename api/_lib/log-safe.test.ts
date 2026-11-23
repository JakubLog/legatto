import { describe, expect, it } from 'vitest';
import { DbError, errorSummary } from './log-safe';

const EMAIL = 'jan.kowalski@example.pl';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.sekret';

describe('errorSummary', () => {
  it('błąd PostgREST z e-mailem w details: tylko kod, bez wartości wiersza', () => {
    const pgErr = {
      message: 'duplicate key value violates unique constraint "contacts_email_key"',
      details: `Key (email)=(${EMAIL}) already exists.`,
      hint: `Użyj innego adresu niż ${EMAIL}`,
      code: '23505',
    };
    const summary = errorSummary(pgErr);
    expect(summary).toEqual({ name: 'object', code: '23505' });
    expect(JSON.stringify(summary)).not.toContain(EMAIL);
  });

  it('błąd fetch z URL z tokenem: kod sieci z cause, bez URL', () => {
    const url = `https://calendar.example.com/feed.ics?token=${TOKEN}`;
    const err = new TypeError(`fetch failed: ${url}`, {
      cause: Object.assign(new Error(`connect ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' }),
    });
    const summary = errorSummary(err);
    expect(summary).toEqual({ name: 'TypeError', code: 'ECONNREFUSED' });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(JSON.stringify(summary)).not.toContain('calendar.example.com');
  });

  it('status HTTP dostawcy przechodzi, body nie', () => {
    const err = Object.assign(new Error(`Resend: invalid recipient ${EMAIL}`), { name: 'ResendError', status: 422, code: 'validation_error' });
    expect(errorSummary(err)).toEqual({ name: 'ResendError', code: 'validation_error', status: 422 });
  });

  it('pole code/name z treścią zamiast identyfikatora jest pomijane', () => {
    expect(errorSummary({ name: `Błąd ${EMAIL}`, code: EMAIL })).toEqual({ name: 'object' });
    expect(errorSummary('tekst z danymi')).toEqual({ name: 'string' });
    expect(errorSummary(null)).toEqual({ name: 'null' });
  });
});

describe('DbError', () => {
  it('niesie operację i kod, nie treść błędu bazy', () => {
    const err = new DbError({ message: `Key (email)=(${EMAIL}) already exists`, details: EMAIL, code: '23505' }, 'contacts insert');
    expect(err.message).toBe('contacts insert: 23505');
    expect(errorSummary(err)).toEqual({ name: 'DbError', code: '23505', op: 'contacts insert' });
  });

  it('błąd Auth/Storage bez kodu: status HTTP', () => {
    expect(new DbError({ message: `User ${EMAIL} not found`, status: 404 }).message).toBe('HTTP 404');
    expect(new DbError(null).message).toBe('błąd bazy');
  });
});
