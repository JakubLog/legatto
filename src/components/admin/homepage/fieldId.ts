/** Stabilne id pola z jego ścieżki w formularzu (np. `hp-identity-mp_name`). */
export function fieldId(name: string): string {
  return `hp-${name.replace(/\./g, '-')}`;
}
