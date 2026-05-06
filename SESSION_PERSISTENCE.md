# Librus Client - Dokumentacja Persystencji Sesji

## Problem

Oryginalny problem polegał na tym, że aplikacja traciła sesję po zamknięciu. Użytkownik musiał logować się za każdym razem, mimo że sesja w Librusie może być ważna przez wiele dni.

## Rozwiązanie

Zaimplementowano kompleksowy system persystencji cookies, który:
1. **Wyodrębnia cookies** z InAppBrowser po udanym logowaniu
2. **Zapisuje cookies** w trwałej pamięci urządzenia (Capacitor Preferences)
3. **Przywraca cookies** przy kolejnym uruchomieniu aplikacji
4. **Wstrzykuje cookies** do InAppBrowser, aby utrzymać sesję

## Architektura

### Przepływ Danych

```
┌─────────────────────────────────────────────────────────────┐
│                      Start Aplikacji                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ checkSessionValid()  │
              │ Sprawdza czy są      │
              │ zapisane cookies     │
              └──────────┬───────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
    TAK (Sesja)                    NIE (Brak sesji)
         │                               │
         ▼                               ▼
┌────────────────────┐         ┌─────────────────────┐
│ InAppBrowser       │         │ InAppBrowser        │
│ (ukryte)           │         │ (widoczne)          │
│ + wstrzyknięte     │         │ Użytkownik loguje   │
│   cookies          │         │ się ręcznie         │
└────────┬───────────┘         └──────────┬──────────┘
         │                                │
         │                                │
         └────────────┬───────────────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │ Po udanym logowaniu:  │
          │ extractAndSave        │
          │ CookiesFromBrowser()  │
          └───────────┬───────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │ Cookies zapisane w    │
          │ Capacitor Preferences │
          │ (persist 30 dni)      │
          └───────────────────────┘
```

## Kluczowe Komponenty

### 1. LibrusAuthService

Główny serwis zarządzający sesją:

#### Metody Persystencji:

**`extractAndSaveCookiesFromBrowser()`**
- Wyodrębnia cookies z InAppBrowser używając JavaScript injection
- Zapisuje cookies do Capacitor Preferences
- Wywołuje się po udanym logowaniu i scrapowaniu danych

**`injectCookiesIntoBrowser()`**
- Wstrzykuje zapisane cookies do InAppBrowser
- Używa `document.cookie` API w JavaScript
- Wywołuje się przy każdym `loadstop` jeśli istnieje ważna sesja

**`saveCookies()`**
- Zapisuje cookies z CapacitorCookies API
- Obsługuje wiele domen Librusa (synergia, portal, api)
- Backup method dla głównej metody extract

**`restoreSavedCookies()`**
- Odczytuje cookies z Preferences przy starcie aplikacji
- Przywraca je do CapacitorCookies
- Sprawdza czy sesja nie wygasła

**`checkSessionValid()`**
- Sprawdza czy istnieje ważna sesja
- Waliduje timestamp wygaśnięcia
- Zwraca boolean informujący o statusie sesji

**`clearSession()`**
- Czyści wszystkie zapisane cookies
- Usuwa dane z Preferences
- Wywołuje się przy wylogowaniu lub wygasłej sesji

### 2. HomePage

Interfejs użytkownika z zarządzaniem sesją:

- **Status sesji**: Pokazuje czy użytkownik jest zalogowany
- **Smart button**: Zmienia tekst w zależności od statusu sesji
- **Logout button**: Pozwala wyczyścić sesję ręcznie
- **Auto-check**: Sprawdza sesję przy starcie i po każdej operacji

## Konfiguracja Capacitor

W `capacitor.config.ts`:

```typescript
plugins: {
  CapacitorCookies: {
    enabled: true, // KRYTYCZNE: włącza persystencję cookies
  }
}
```

## Bezpieczeństwo i Cloudflare

### Wyzwania z Librusem:

1. **Cloudflare Protection**: Librus używa Cloudflare, co utrudnia bezpośrednie HTTP requesty
2. **Strict Cookie Policy**: Cookies mają restrykcje domeny i path
3. **Session Timeout**: Sesja może wygasnąć po stronie serwera

### Nasza Strategia:

- **InAppBrowser**: Omija Cloudflare protection dzięki rzeczywistemu WebView
- **JavaScript Injection**: Wyodrębnia cookies bezpośrednio z DOM
- **Cookie Restoration**: Wstrzykuje cookies przed każdym żądaniem
- **Expiration Handling**: Lokalna walidacja wygaśnięcia (30 dni)

## Przepływ Użytkownika

### Pierwsze Logowanie:

1. Użytkownik otwiera aplikację
2. Widzi status "Wylogowany"
3. Klika "ZALOGUJ I POBIERZ OCENY"
4. Otwiera się InAppBrowser z formularzem Librusa
5. Użytkownik loguje się ręcznie
6. Po udanym logowaniu:
   - Cookies są automatycznie wyodrębnione
   - Zapisane w Preferences
   - InAppBrowser ukrywa się
   - Wyświetlają się oceny

### Kolejne Uruchomienie:

1. Użytkownik otwiera aplikację
2. Automatycznie przywracane są cookies
3. Widzi status "Zalogowany"
4. Klika "ODŚWIEŻ OCENY"
5. InAppBrowser otwiera się w tle (ukryty)
6. Cookies są wstrzykiwane
7. Automatycznie pobiera dane bez logowania
8. Wyświetlają się oceny

### Wylogowanie:

1. Użytkownik klika "WYLOGUJ"
2. Wszystkie cookies są usuwane
3. Status zmienia się na "Wylogowany"
4. Przy następnym kliknięciu będzie musiał się zalogować

## Czas Życia Sesji

- **Lokalne wygaśnięcie**: 30 dni od ostatniego logowania
- **Serwer Librus**: Może wymusić wylogowanie wcześniej
- **Auto-cleanup**: Wygasłe sesje są automatycznie czyszczone

## Debugowanie

### Console Logs:

Aplikacja loguje wszystkie kluczowe operacje:

```
✅ "Przywracam X zapisanych cookies..."
✅ "Cookies wstrzyknięte do przeglądarki."
✅ "Zapisano X cookies wyodrębnionych z przeglądarki."
❌ "Sesja wygasła, usuwam stare cookies."
❌ "Wymagane ponowne logowanie ręczne."
```

### Sprawdzanie Stored Cookies:

```typescript
// W Chrome DevTools Console (podczas debugowania web):
import { Preferences } from '@capacitor/preferences';
const { value } = await Preferences.get({ key: 'librus_session_cookies' });
console.log(JSON.parse(value));
```

## Przyszłe Ulepszenia

### Możliwe rozszerzenia:

1. **Biometric Auth**: Dodać Touch ID/Face ID przed wyświetleniem danych
2. **Background Sync**: Automatyczne odświeżanie w tle
3. **Push Notifications**: Powiadomienia o nowych ocenach
4. **Offline Mode**: Cache danych dla trybu offline
5. **Multiple Accounts**: Wsparcie dla wielu kont Librus
6. **Token Refresh**: Automatyczne odświeżanie sesji przed wygaśnięciem

## Wymagania

### Zależności:

```json
{
  "@capacitor/core": "^8.0.0",
  "@capacitor/preferences": "^8.0.0",
  "@awesome-cordova-plugins/in-app-browser": "^9.1.4",
  "cordova-plugin-inappbrowser": "^6.0.0"
}
```

### Platformy:

- ✅ Android (testowane)
- ✅ iOS (powinno działać)
- ❌ Web (ograniczone - InAppBrowser wymaga natywnej platformy)

## Troubleshooting

### Problem: "Sesja wygasła po 1 dniu"
**Rozwiązanie**: Librus może wymuszać logout po stronie serwera. To normalne.

### Problem: "Cookies nie są zapisywane"
**Rozwiązanie**: 
- Sprawdź czy `CapacitorCookies.enabled = true` w config
- Sprawdź uprawnienia aplikacji
- Sprawdź logi w konsoli

### Problem: "InAppBrowser pokazuje się mimo sesji"
**Rozwiązanie**: 
- Sprawdź czy cookies są poprawnie wstrzykiwane
- Może być problem z domeną cookies
- Spróbuj wylogować i zalogować ponownie

### Problem: "Brak danych po kliknięciu"
**Rozwiązanie**: 
- Sprawdź połączenie internetowe
- Sprawdź czy Librus nie zmienił struktury HTML
- Sprawdź logi JavaScript w InAppBrowser

## Podsumowanie

System persystencji sesji działa na zasadzie:
1. **Extract** → Wyciągnij cookies z InAppBrowser
2. **Store** → Zapisz w Preferences (trwała pamięć)
3. **Restore** → Odczytaj przy starcie
4. **Inject** → Wstrzyknij do InAppBrowser przy każdym żądaniu

To pozwala na bezproblemowe korzystanie z aplikacji bez konieczności logowania przy każdym uruchomieniu, przy zachowaniu bezpieczeństwa i kompatybilności z systemem Librus.
