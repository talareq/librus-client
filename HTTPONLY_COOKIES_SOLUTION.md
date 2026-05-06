# Rozwiązanie Problemu: HttpOnly Cookies

## 🔍 Diagnoza Problemu

Z logów widzimy że:
```
💉 Wstrzykuję 2 cookies...
✅ Cookies wstrzyknięte: przedmioty_76474=zachowanie; TestCookie=1
⚠️ Przekierowano do logowania - sesja nieważna.
```

**Problem:** JavaScript może odczytać tylko cookies które NIE są `HttpOnly`. Prawdziwe cookies sesyjne (jak `PHPSESSID`) są `HttpOnly` i są **niewidoczne** dla `document.cookie`!

## ✅ Nowe Rozwiązanie: Persistent Browser Instance

Zamiast próbować kopiować cookies (niemożliwe dla HttpOnly), **utrzymujemy instancję InAppBrowser żywą**:

### Jak to działa:

```
┌─────────────────────────────────────────────────────────┐
│                    Pierwsze Logowanie                    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Otwórz IAB     │ ← Browser #1
                    │ Użytkownik     │
                    │ loguje się     │
                    └───────┬────────┘
                            │
                            ▼
                    ┌────────────────┐
                    │ Sesja aktywna! │
                    │ Zapisz marker  │ ← Tylko flag, NIE cookies
                    │ UKRYJ browser  │ ← Browser #1 ukryty, ALE ŻYWY
                    └───────┬────────┘
                            │
                  ┌─────────┴─────────┐
                  │  Zamknięcie App   │
                  └─────────┬─────────┘
                            │
                  ┌─────────┴─────────┐
                  │  Restart App      │
                  └─────────┬─────────┘
                            │
                            ▼
        ┌───────────────────────────────────┐
        │ Browser #1 NADAL ISTNIEJE?        │
        └───────┬──────────────┬────────────┘
                │              │
            TAK │              │ NIE
                │              │
                ▼              ▼
      ┌─────────────┐    ┌─────────────┐
      │ Użyj Browser│    │ Nowy browser│
      │ #1 z sesją! │    │ Poproś o    │
      │ .show()     │    │ logowanie   │
      └─────────────┘    └─────────────┘
```

### Kluczowe zmiany:

1. **NIE zamykamy InAppBrowser** - tylko go ukrywamy (`.hide()`)
2. **NIE kopiujemy cookies** - zostają w naturalnym cookie jar przeglądarki
3. **Marker sesji** - zapisujemy tylko flagę że browser ma aktywną sesję
4. **Sprawdzenie sesji** - weryfikuje czy browser instance nadal istnieje

## 📝 Kod - Kluczowe Metody

### `markSessionActive()`
```typescript
// Zapisuje tylko marker (timestamp + flag), NIE cookies
{
  active: true,
  timestamp: Date.now(),
  expiresAt: Date.now() + 30 dni
}
```

### `checkSessionValid()`
```typescript
// Sprawdza 3 rzeczy:
- Czy marker istnieje?
- Czy nie wygasł lokalnie (30 dni)?
- Czy browser instance nadal żyje? ← KLUCZOWE
```

### `pobierzOcenyHybrydowo()`
```typescript
if (!this.browser) {
  // Stwórz NOWY browser
  this.browser = this.iab.create(...)
} else {
  // UŻYJ ISTNIEJĄCEGO browser (ma cookies!)
  this.browser.show()
  this.browser.navigateTo(...)
}
```

### `forceLogout()`
```typescript
// TERAZ dopiero zamykamy browser
this.browser.close()
this.browser = null
```

## 🎯 Testing - Nowa procedura

### Test 1: Pierwsze logowanie
1. Kliknij "ZALOGUJ I POBIERZ OCENY"
2. Zaloguj się
3. Zobacz logi:
   ```
   ✅ Mamy sesję! Scrapowanie danych...
   ✅ Sukces! Zapisuję marker sesji.
   ✅ Marker sesji zapisany.
   ```

### Test 2: **Restart bez zamykania InAppBrowser** ⚠️

**UWAGA:** Standardowy restart app w Android Studio **może zamknąć InAppBrowser**!

Aby przetestować:
```bash
# OPCJA A: Wyślij app do tła i przywróć
adb shell input keyevent KEYCODE_HOME
# Poczekaj 2 sekundy
adb shell am start -n com.twojadomena.librus/.MainActivity

# OPCJA B: Restart procesu (symuluje restart systemu)
adb shell am kill com.twojadomena.librus
adb shell am start -n com.twojadomena.librus/.MainActivity
```

Po restarcie:
```
=== ROZPOCZYNAM SESJĘ ===
Czy mam zapisaną sesję? true
📊 Status sesji: {isActive: true, notExpired: true, browserExists: true}
🔄 Przeglądarka już istnieje, używam istniejącej sesji...
📍 Adres URL: https://synergia.librus.pl/przegladaj_oceny/uczen
✅ Mamy sesję! Scrapowanie danych...
```

### Test 3: Wylogowanie
1. Kliknij "WYLOGUJ"
2. Browser zostanie **zamknięty** (`.close()`)
3. Przy następnym kliknięciu: nowy browser, nowe logowanie

## ⚠️ Ograniczenia Android/iOS

### Problem z restartem aplikacji:
- **Android:** System MOŻE zabić proces aplikacji w tle
- **iOS:** System MOŻE zabić WebView gdy app jest w background długo
- **Stop w Android Studio:** ZAWSZE zabija proces (w tym InAppBrowser)

### Kiedy sesja będzie utracona:
- ✅ Normalny minimize/restore: DZIAŁA
- ❌ Force stop / reboot urządzenia: Sesja utracona
- ❌ Stop w Android Studio: Sesja utracona
- ⚠️ App długo w tle (godziny): Może być utracona przez OS

## 💡 Rozwiązania na przyszłość

Jeśli chcesz prawdziwą persystencję między restartami:

### Opcja 1: Capacitor HTTP Plugin z Cookie Storage
```typescript
// Nie używa InAppBrowser, tylko natywne HTTP
// Może zapisywać cookies w keychain (iOS) / keystore (Android)
```

### Opcja 2: Native Plugin
```typescript
// Napisać natywny plugin Android/iOS który ma dostęp do
// CookieManager i może zapisywać/przywracać cookies
```

### Opcja 3: API Token zamiast cookies
```typescript
// Jeśli Librus API wspiera tokeny
// (ale prawdopodobnie nie, bo to portal web)
```

## 📊 Co się zmieniło w kodzie

| Stara wersja | Nowa wersja |
|-------------|-------------|
| `extractAndSaveCookiesFromBrowser()` | `markSessionActive()` |
| `injectCookiesIntoBrowser()` | *(usunięte - nie potrzebne)* |
| `restoreSavedCookies()` | *(usunięte - nie potrzebne)* |
| Zapisuje: cookies array | Zapisuje: tylko marker flag |
| Sprawdza: czy cookies istnieją | Sprawdza: czy browser istnieje |
| Zamyka browser: nigdy | Zamyka browser: przy wylogowaniu |

## 🎓 Wnioski

1. **HttpOnly cookies są niewidoczne dla JavaScript** - to feature bezpieczeństwa
2. **InAppBrowser trzyma cookies w swojej pamięci** - dopóki żyje
3. **Restart aplikacji MOŻE zabić InAppBrowser** - zależy od OS
4. **Dla true persistence** - potrzebny natywny plugin z dostępem do cookie storage

## ✅ Co teraz działa

- ✅ Sesja przetrwa minimize → restore
- ✅ Sesja przetrwa nawigację w app
- ✅ Logout czyści wszystko
- ⚠️ Sesja może być utracona po force-stop

## 🧪 Jak teraz testować

1. **Zaloguj się**
2. **Minimize app** (Home button)
3. **Przywróć app** (z recent apps)
4. **Kliknij "ODŚWIEŻ OCENY"**
5. **Powinno załadować BEZ logowania** ✅

**Uwaga:** Stop w Android Studio zabije proces - to nie jest realistyczny test!
