// Adresy publiczne tej instancji (jedna instancja = jeden poseł = własna domena).
// Liczone z origin bieżącej strony, więc nie ma domeny wpisanej w kod.

/** Adres endpointu MCP tej instancji, np. https://biuro.example.pl/api/mcp. */
export function getMcpUrl(): string {
  return `${window.location.origin}/api/mcp`;
}
