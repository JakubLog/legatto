import { describe, expect, it, vi } from 'vitest';
import { icsAllowedHosts, instanceFlags, isIcsHostAllowed } from './instance';

vi.spyOn(console, 'error').mockImplementation(() => {});

describe('flagi instancji', () => {
  it('Vercel: AI/MCP/e-mail fail-closed, push/GetResponse/ICS jak dotąd', () => {
    expect(instanceFlags({})).toEqual({ ai: false, mcp: false, email: false, push: true, getresponse: true, ics: true });
  });

  it('VPS: wszystko opt-in', () => {
    expect(instanceFlags({ LEGATTO_TARGET: 'selfhost' })).toEqual({
      ai: false,
      mcp: false,
      email: false,
      push: false,
      getresponse: false,
      ics: false,
    });
  });

  it('MCP niezależny od AI', () => {
    expect(instanceFlags({ INSTANCE_AI: 'off', INSTANCE_MCP: 'on' })).toMatchObject({ ai: false, mcp: true });
    expect(instanceFlags({ INSTANCE_AI: 'on' })).toMatchObject({ ai: true, mcp: false });
  });

  it('niepoprawna wartość = off', () => {
    expect(instanceFlags({ INSTANCE_PUSH: 'yes' }).push).toBe(false);
    expect(instanceFlags({ INSTANCE_ICS: ' ON ' }).ics).toBe(true);
  });
});

describe('ICS_ALLOWED_HOSTS', () => {
  it('Vercel bez zmiennej = bez listy; VPS bez zmiennej = pusta lista', () => {
    expect(icsAllowedHosts({})).toBeNull();
    expect(icsAllowedHosts({ LEGATTO_TARGET: 'selfhost' })).toEqual([]);
  });

  it('dokładne nazwy hostów, bez wildcardów i adresów IP', () => {
    const env = { ICS_ALLOWED_HOSTS: 'Calendar.Google.com, *.example.com, 10.0.0.1, outlook.office365.com,' };
    expect(icsAllowedHosts(env)).toEqual(['calendar.google.com', 'outlook.office365.com']);
    expect(isIcsHostAllowed('https://calendar.google.com/calendar/ical/x/basic.ics', env)).toBe(true);
    expect(isIcsHostAllowed('https://evil.calendar.google.com.attacker.pl/x.ics', env)).toBe(false);
    expect(isIcsHostAllowed('nie-url', env)).toBe(false);
  });
});
