# Rozszerzenie Claude Desktop „Legatto” (`.mcpb`)

Rozszerzenie łączy Claude Desktop z serwerem MCP portalu biura (`https://app.<domena>/api/mcp`).
Claude dostaje te same narzędzia i procedury co integracja MCP w portalu (sprawy, kontakty, wydarzenia,
interpelacje, budżet), z uprawnieniami Twojego konta.

Serwer biura działa **tylko w sieci VPN biura** (Tailscale/Headscale) – nie ma publicznego adresu.
Dlatego claude.ai w przeglądarce i aplikacje mobilne nie mogą się z nim połączyć; Claude Desktop
z tym rozszerzeniem łączy się z Twojego komputera, gdy VPN jest włączony.

## Wymagania

- Claude Desktop z obsługą rozszerzeń (Ustawienia → Rozszerzenia).
- Komputer podłączony do VPN biura (Tailscale/Headscale), z dostępem do `https://app.<domena>`.
- Konto w portalu biura z rolą Poseł/Posłanka, Administrator albo Pracownik, z włączoną weryfikacją dwuetapową.
- Integracja MCP włączona w tym biurze (w przeciwnym razie rozszerzenie pokaże komunikat
  „Integracja z Claude nie jest dostępna w tym biurze”).

## Instalacja

1. Pobierz plik `legatto.mcpb` (od administratora biura albo z wydania aplikacji).
2. Otwórz go dwuklikiem albo w Claude Desktop: **Ustawienia → Rozszerzenia → Ustawienia zaawansowane →
   Zainstaluj rozszerzenie…** i wskaż plik.
3. Uzupełnij ustawienia rozszerzenia:
   - **Adres portalu biura** – np. `https://app.twojadomena.pl` (można wkleić też adres MCP z portalu,
     zakończony `/api/mcp`).
   - **Client ID** i **Client Secret** aplikacji OAuth – w portalu biura: **Integracje → OAuth Apps →
     „Nowa App”**. Client Secret jest widoczny tylko raz, zaraz po utworzeniu.
   - albo **Token MCP** (zamiast OAuth) – w portalu: **Integracje → Tokeny MCP → „Wygeneruj token”**.
     Gdy token jest wpisany, Client ID i Secret są pomijane.
4. Włącz rozszerzenie.

## Pierwsze logowanie (OAuth)

Przy pierwszym użyciu rozszerzenie otwiera przeglądarkę ze stroną logowania portalu biura
(przepływ OAuth 2.1 z PKCE, ten sam co dla claude.ai). Zaloguj się (z weryfikacją dwuetapową)
i zatwierdź dostęp. Portal przekierowuje przeglądarkę na lokalny adres `http://127.0.0.1:<port>/callback`
obsługiwany przez rozszerzenie – zobaczysz stronę „Zalogowano”, możesz zamknąć kartę.

Jeśli logowanie trwa dłużej niż ok. 45 sekund, Claude pokaże komunikat „Zaloguj się do portalu biura
w oknie przeglądarki…”. Dokończ logowanie, a potem ponów polecenie (albo wyłącz i włącz rozszerzenie) –
okno logowania czeka do 10 minut.

Token dostępu jest ważny 30 dni (tyle wydaje serwer biura). Po wygaśnięciu albo unieważnieniu tokenu
(np. odebranie dostępu w portalu) rozszerzenie samo otworzy przeglądarkę do ponownego logowania.
Jeśli serwer wyda refresh token, rozszerzenie odświeży dostęp bez przeglądarki.

## Gdzie są zapisane tokeny

Tokeny OAuth są zapisywane tylko na tym komputerze, w pliku dostępnym wyłącznie dla Twojego konta
systemowego (plik `0600`, nowy katalog `0700`):

| System  | Katalog |
|---|---|
| macOS   | `~/Library/Application Support/Legatto MCP/` |
| Windows | `%APPDATA%\Legatto MCP\` |
| Linux   | `$XDG_CONFIG_HOME/legatto-mcp/` (domyślnie `~/.config/legatto-mcp/`) |

Plik nazywa się `oauth-<skrót>.json` (osobny dla każdej pary adres biura + Client ID).
Aby wylogować rozszerzenie, usuń ten plik albo unieważnij aplikację OAuth w portalu.
Rozszerzenie nigdy nie wypisuje tokenów ani sekretów do dziennika.
Token MCP i Client Secret wpisane w ustawieniach przechowuje Claude Desktop (pola oznaczone jako poufne).

## Rozwiązywanie problemów

| Komunikat | Co zrobić |
|---|---|
| „Brak połączenia z serwerem biura (…). Włącz VPN biura (Tailscale/Headscale)…” | Włącz VPN biura i ponów polecenie. Gdy VPN działa, serwer może być chwilowo niedostępny. |
| „Nie można zweryfikować certyfikatu TLS serwera biura…” | Sprawdź adres biura; jeśli jest poprawny – zgłoś administratorowi. |
| „Serwer biura odrzucił Client ID lub Client Secret…” | Skopiuj dane aplikacji OAuth ponownie albo utwórz nową aplikację w portalu. |
| „Serwer biura odrzucił token MCP…” | Wygeneruj nowy token w portalu (Integracje → Tokeny MCP). |
| „Serwer biura podaje inny adres kanoniczny (…)” | Wpisz w ustawieniach dokładnie podany adres. |
| „Integracja z Claude nie jest dostępna w tym biurze…” | Integracja MCP jest wyłączona na tej instancji – skontaktuj się z administratorem. |

Dziennik rozszerzenia (bez tokenów) zapisuje Claude Desktop: na macOS w `~/Library/Logs/Claude/`,
na Windows w `%APPDATA%\Claude\logs\` (plik `mcp-server-…log`).

## Dla deweloperów

### Budowa

```sh
node mcpb/build.mjs
```

Wynik: `mcpb/dist/legatto.mcpb` (ZIP: `manifest.json`, `icon.png` z `public/apple-touch-icon.png`,
`LICENSE`, `server/**/*.mjs`). Skrypt nie używa narzędzi zewnętrznych: sprawdza manifest
(podzbiór schematu MCPB `manifest_version` 0.3), sprawdza, że kod serwera importuje wyłącznie moduły
`node:*` i własne pliki, i składa ZIP przez `zlib`. Paczka jest deterministyczna (stała kolejność plików,
data `SOURCE_DATE_EPOCH` albo 2026-01-01) – skrót SHA-256 wypisany przez skrypt można porównać z wydaniem.

Opcjonalnie paczkę można sprawdzić oficjalnym narzędziem (nie jest potrzebne do budowy):

```sh
npx @anthropic-ai/mcpb@2.1.2 unpack mcpb/dist/legatto.mcpb /tmp/legatto-mcpb
npx @anthropic-ai/mcpb@2.1.2 validate /tmp/legatto-mcpb/manifest.json
```

### Testy

```sh
node_modules/.bin/vitest run --config mcpb/vitest.config.mjs
```

Testy obejmują PKCE (wektor RFC 7636), parser SSE, plik tokenów, pełny przepływ proxy na atrapie serwera
biura (`mcpb/test/fake-office.mjs`: discovery, authorize, token, MCP w wariancie JSON i SSE z
`Mcp-Session-Id`): initialize → tools/list, logowanie OAuth z PKCE przez lokalny callback,
401 → odświeżenie tokenu albo ponowne logowanie, wygasła sesja, serwer nieosiągalny, anulowanie żądania,
uruchomienie `server/index.mjs` na stdio i pakowanie.

### Jak to działa

- `server/index.mjs` – serwer MCP na stdio (JSON-RPC, jedna wiadomość na linię), konfiguracja z
  `user_config` (zmienne `LEGATTO_OFFICE_URL`, `LEGATTO_CLIENT_ID`, `LEGATTO_CLIENT_SECRET`,
  `LEGATTO_MCP_TOKEN`; `LEGATTO_DATA_DIR` zmienia katalog tokenów).
- `server/lib/proxy.mjs` – klient Streamable HTTP: każda wiadomość to `POST /api/mcp` z
  `Accept: application/json, text/event-stream`; odpowiedzi JSON, SSE albo 202; nagłówki `Mcp-Session-Id`
  i `MCP-Protocol-Version`; 404 przy aktywnej sesji → ponowna inicjalizacja; 401 → odnowienie tokenu i
  jedno ponowienie; odpowiedzi serwera na powiadomienia (`id: null`) nie trafiają do klienta; każde żądanie
  dostaje odpowiedź (z polskim komunikatem przy błędzie). Przekierowania HTTP nie są wykonywane.
- `server/lib/oauth.mjs`, `server/lib/auth.mjs` – OAuth 2.1 Authorization Code + PKCE S256
  (discovery `/.well-known/oauth-authorization-server`, endpointy muszą leżeć pod adresem biura),
  `client_secret_post`, lokalny callback na `127.0.0.1` z losowym portem i weryfikacją `state`.
- `server/lib/token-store.mjs` – zapis atomowy pliku tokenów `0600`.

Strumień GET (powiadomienia serwera poza odpowiedziami) nie jest otwierany – serwer biura go nie udostępnia.
