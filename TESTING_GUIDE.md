# Instrukcja Testowania Persystencji Cookies

## 🔍 Co zostało naprawione?

### Problem:
Po zamknięciu i otwarciu aplikacji, cookies nie były prawidłowo wstrzykiwane do InAppBrowser, co powodowało przekierowanie na landing page zamiast do strony z ocenami.

### Rozwiązanie:
1. **Automatyczne przeładowanie** - Po wstrzyknięciu cookies, przeglądarka przeładowuje stronę
2. **Lepsze wykrywanie stanów** - Dodano wykrywanie landing page i automatyczne pokazywanie okna logowania
3. **Ulepszone logowanie** - Emoji i bardziej szczegółowe logi w konsoli/logcat
4. **Domain cookies** - Cookies są teraz zapisywane z domeną `.librus.pl` dla lepszej kompatybilności
5. **Debug mode** - Nowy przycisk "DEBUG COOKIES" do sprawdzania zapisanych cookies

## 📋 Procedura testowania krok po kroku

### Test 1: Pierwsze logowanie i zapis cookies

1. **Otwórz aplikację** w emulatorze
2. **Kliknij "DEBUG COOKIES"** - Powinno pokazać że nie ma cookies
3. **Kliknij "ZALOGUJ I POBIERZ OCENY"**
4. **Zaloguj się** w oknie InAppBrowser
5. **Poczekaj** aż okno zniknie i pojawią się oceny
6. **Sprawdź logcat** - Szukaj:
   ```
   ✅ Zalogowano pomyślnie, zapisuję cookies...
   📦 Wyodrębnione cookies: [długi string]
   ✅ Zapisano X cookies do Preferences.
   📋 Lista cookies: [nazwy cookies]
   ```
7. **Kliknij "DEBUG COOKIES"** - Powinno pokazać ilość i nazwy zapisanych cookies

### Test 2: Restart aplikacji (główny test)

1. **Zatrzymaj aplikację** (Stop w Android Studio)
2. **Uruchom ponownie** aplikację
3. **Sprawdź status** - Powinno pokazać chip "Zalogowany" (zielony)
4. **Kliknij "DEBUG COOKIES"** - Sprawdź czy cookies nadal są zapisane
5. **Sprawdź logcat** przed kliknięciem - Szukaj:
   ```
   Przywracam X zapisanych cookies...
   Cookies przywrócone pomyślnie!
   ```
6. **Kliknij "ODŚWIEŻ OCENY"**
7. **Sprawdź logcat** - Szukaj sekwencji:
   ```
   === ROZPOCZYNAM SESJĘ ===
   Czy mam zapisaną sesję? true
   ✅ Używam zapisanej sesji - okno ukryte.
   📍 Adres URL: https://synergia.librus.pl/przegladaj_oceny/uczen
   💉 Wstrzykuję cookies...
   💉 Wstrzykuję X cookies...
   ✅ Cookies wstrzyknięte do przeglądarki. Wynik: [...]
   🔄 Przeładowuję stronę z cookies...
   📍 Adres URL: https://synergia.librus.pl/przegladaj_oceny/uczen
   ✅ Mamy sesję! Scrapowanie danych...
   ✅ Sukces! Zapisuję cookies i ukrywam proces robota.
   ```
8. **Oceny powinny się załadować** BEZ pokazywania okna logowania

### Test 3: Co jeśli cookies nie zadziałają?

Jeśli po punkcie 7 w Teście 2 zobaczysz w logcat:
```
⚠️ Nieprawidłowa strona, prawdopodobnie cookies nie zadziałały.
Pokazuję okno do ręcznego logowania...
```

To znaczy że:
- Cookies są zapisane
- Cookies są wstrzykiwane
- ALE Librus ich nie akceptuje (może wygasły po stronie serwera)

W tym przypadku:
1. **Okno InAppBrowser się pokaże**
2. **Zaloguj się ponownie ręcznie**
3. **Nowe cookies zostaną zapisane**
4. **Przy następnym restarcie powinno działać**

### Test 4: Wylogowanie

1. **Kliknij "WYLOGUJ"**
2. **Status zmieni się na "Wylogowany"**
3. **Kliknij "DEBUG COOKIES"** - Powinno pokazać brak cookies
4. **Zamknij i otwórz aplikację**
5. **Status nadal "Wylogowany"**
6. **Kliknij "ZALOGUJ I POBIERZ OCENY"** - Powinno pokazać okno logowania

### Test 5: Force-stop (Hard test)

```bash
adb shell am force-stop com.twojadomena.librus
```

Potem otwórz aplikację z ekranu głównego emulatora.
Powinno działać tak samo jak Test 2.

## 🔬 Analiza Logcat - Szczegółowo

### Prawidłowy przepływ z zapisaną sesją:

```
=== ROZPOCZYNAM SESJĘ ===
Czy mam zapisaną sesję? true
✅ Używam zapisanej sesji - okno ukryte.
📍 Adres URL: https://synergia.librus.pl/przegladaj_oceny/uczen
💉 Wstrzykuję cookies...
💉 Wstrzykuję 5 cookies...
✅ Cookies wstrzyknięte do przeglądarki. Wynik: PHPSESSID=abc123...
🔄 Przeładowuję stronę z cookies...
📍 Adres URL: https://synergia.librus.pl/przegladaj_oceny/uczen
✅ Mamy sesję! Scrapowanie danych...
✅ Sukces! Zapisuję cookies i ukrywam proces robota.
📦 Wyodrębnione cookies: PHPSESSID=abc123; ...
✅ Zapisano 5 cookies do Preferences.
📋 Lista cookies: PHPSESSID, sessionId, ...
```

### Nieprawidłowy przepływ (sesja wygasła po stronie Librus):

```
=== ROZPOCZYNAM SESJĘ ===
Czy mam zapisaną sesję? true
✅ Używam zapisanej sesji - okno ukryte.
📍 Adres URL: https://portal.librus.pl/rodzina/synergia/loguj
⚠️ Przekierowano do logowania - sesja nieważna.
Wymagane ponowne logowanie ręczne.
```

LUB:

```
=== ROZPOCZYNAM SESJĘ ===
Czy mam zapisaną sesję? true
✅ Używam zapisanej sesji - okno ukryte.
📍 Adres URL: https://synergia.librus.pl/ (landing page)
⚠️ Nieprawidłowa strona, prawdopodobnie cookies nie zadziałały.
Pokazuję okno do ręcznego logowania...
```

## 🛠️ Komendy Debug w Terminalu

### Sprawdź czy aplikacja ma zapisane dane:
```bash
adb shell run-as com.twojadomena.librus ls -la /data/data/com.twojadomena.librus/shared_prefs/
```

### Zobacz zawartość preferences (może nie działać na niektórych wersjach Androida):
```bash
adb shell run-as com.twojadomena.librus cat /data/data/com.twojadomena.librus/shared_prefs/CapacitorStorage.xml
```

### Live logcat z filtrowaniem:
```bash
adb logcat | grep -E "(ROZPOCZYNAM|Cookies|cookies|sesj|🔄|✅|❌|⚠️|💉|📍|📦|📋)"
```

### Wyczyść dane aplikacji (hard reset):
```bash
adb shell pm clear com.twojadomena.librus
```

## 📊 Tabela stanów

| Stan | URL | Co się dzieje | Log |
|------|-----|---------------|-----|
| ✅ Sukces | `przegladaj_oceny/uczen` | Scraping ocen | "Mamy sesję!" |
| ✅ Po logowaniu | `uczen/index` lub `rodzina/index` | Zapis cookies, redirect | "Zalogowano pomyślnie" |
| ⚠️ Wymagane logowanie | `portal.librus.pl` lub `/loguj` | Pokazuje okno | "Przekierowano do logowania" |
| ⚠️ Landing page | Inne URL w synergia.librus.pl | Pokazuje okno | "Nieprawidłowa strona" |

## 🎯 Kryteria sukcesu

Test zaliczony jeśli:

- [ ] Po pierwszym logowaniu w logcat widać "✅ Zapisano X cookies"
- [ ] "DEBUG COOKIES" pokazuje zapisane cookies
- [ ] Po restarcie aplikacji status pokazuje "Zalogowany"
- [ ] Po kliknięciu "ODŚWIEŻ OCENY" NIE pokazuje się okno logowania
- [ ] Oceny ładują się automatycznie
- [ ] W logcat widać "💉 Wstrzykuję cookies..." i "✅ Mamy sesję!"

## ❓ FAQ - Troubleshooting

### Q: Widzę "💉 Wstrzykuję cookies..." ale dalej landing page?
**A:** Cookies mogły wygasnąć po stronie serwera Librus. To normalne po kilku dniach. Zaloguj się ponownie.

### Q: "DEBUG COOKIES" mówi że brak cookies mimo że się zalogowałem?
**A:** Sprawdź w logcat czy było "✅ Zapisano X cookies". Jeśli nie, może być problem z uprawnieniami storage.

### Q: Po każdym restarcie prosi o logowanie?
**A:** 
1. Sprawdź czy `CapacitorCookies.enabled = true` w capacitor.config.ts
2. Sprawdź uprawnienia storage aplikacji
3. Spróbuj wyczyścić dane: `adb shell pm clear com.twojadomena.librus` i zaloguj od nowa

### Q: Aplikacja się zawiesza na "Łączenie z Librusem..."?
**A:** Prawdopodobnie InAppBrowser nie może się otworzyć. Sprawdź czy plugin jest zainstalowany:
```bash
npx cap sync
```

### Q: Widzę tylko "Sesja aktywna" ale brak ocen?
**A:** Kliknij "ODŚWIEŻ OCENY" aby pobrać dane. Status "Zalogowany" oznacza tylko że cookies są zapisane.

## 🔄 Wersja test expiration (2 minuty)

Obecnie SESSION_DURATION jest ustawiony na **2 minuty** dla testów.

Aby przetestować expiration:
1. Zaloguj się
2. Poczekaj 2+ minuty
3. Kliknij "DEBUG COOKIES" - Powinno pokazać "Czy wygasło? true"
4. Kliknij "ODŚWIEŻ OCENY" - Powinno pokazać okno logowania

**WAŻNE:** Przed publikacją produkcyjną, przywróć:
```typescript
private readonly SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 dni
```

## 📝 Następne kroki po udanych testach

Jeśli wszystko działa:
1. Przywróć SESSION_DURATION do 30 dni
2. Usuń przycisk "DEBUG COOKIES" z produkcji (opcjonalnie)
3. Zbuduj release APK
4. Przetestuj na prawdziwym urządzeniu

Powodzenia! 🚀
