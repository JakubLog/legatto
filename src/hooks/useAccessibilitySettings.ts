import { useSyncExternalStore } from 'react';
import { getAccessibilityState, subscribeAccessibility } from '@/lib/accessibility';

/** Ustawienia dostępności tego urządzenia (zapis: saveAccessibilitySettings). */
export function useAccessibilitySettings() {
  return useSyncExternalStore(subscribeAccessibility, getAccessibilityState);
}
