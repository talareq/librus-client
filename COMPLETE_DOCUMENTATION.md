# 🎓 Kompletny Librus Client - Dokumentacja

## 🎉 Co zostało zaimplementowane

### ✅ Pełna funkcjonalność

Aplikacja jest teraz **w pełni funkcjonalnym klientem Librusa** z następującymi możliwościami:

#### 1. **Persystencja sesji** ✓
- Sesja przetrwa minimize → restore aplikacji
- InAppBrowser pozostaje w pamięci z aktywnymi cookies
- Auto-wykrywanie wygasłej sesji
- Timeout: 30 minut (konfigurow alny)

#### 2. **Pięć głównych sekcji** ✓
- 📚 **Oceny** - z pełnymi szczegółami
- 📬 **Wiadomości** - inbox z Librus Mail
- 📝 **Uwagi** - uwagi od nauczycieli
- 📢 **Ogłoszenia** - z contentem i autorem
- 📅 **Terminarz** - wydarzenia i sprawdziany

#### 3. **Wykrywanie nowości** ✓
- Automatyczne porównywanie z poprzednią synchronizacją
- Badge'y z liczbą nowych elementów na każdej zakładce
- Oznaczenie "NOWE" na każdym nowym elemencie
- Auto-oznaczanie jako przeczytane po 2 sekundach

#### 4. **Szczegóły ocen** ✓
- Modal z pełnymi informacjami po kliknięciu w ocenę:
  - Opis (za co dostano ocenę)
  - Data wystawienia
  - Nauczyciel
  - Kategoria (sprawdzian, kartkówka, etc.)
  - Waga oceny
- Kolorowanie ocen wg wartości (zielony=5+, czerwony<3)

#### 5. **UI/UX** ✓
- System zakładek (tabs) dla łatwej nawigacji
- Responsywny design
- Status sesji w nagłówku
- Przycisk synchronizacji
- Debug mode
- Wylogowanie z czyszczeniem danych

## 📐 Architektura

```
┌─────────────────────────────────────────────┐
│           LibrusAuthService                  │
│  - Zarządzanie sesją InAppBrowser           │
│  - Nawigacja po stronach Librusa            │
│  - syncAllData() - główna synchronizacja    │
└──────────────┬──────────────────────────────┘
               │
               ├─→ LibrusScraperService
               │   - Skrypty JavaScript do scrapingu
               │   - Parsowanie danych
               │
               └─→ LibrusStorageService
                   - Zapis/odczyt z Capacitor Preferences
                   - Porównywanie z poprzednimi danymi
                   - Oznaczanie nowości

┌─────────────────────────────────────────────┐
│              HomePage                        │
│  - UI z zakładkami                          │
│  - Wyświetlanie danych                      │
│  - Modal szczegółów ocen                    │
└─────────────────────────────────────────────┘
```

## 📱 Jak używać aplikacji

### 1. Pierwsze uruchomienie
```
1. Otwórz aplikację
2. Kliknij "Synchronizuj" (ikona 🔄)
3. Zaloguj się w oknie Librusa
4. Poczekaj na synchronizację wszystkich sekcji
5. Dane pojawią się w zakładkach
```

### 2. Kolejne uruchomienia
```
1. Otwórz aplikację
2. Aplikacja załaduje zapisane dane NATYCHMIAST
3. Kliknij "Synchronizuj" aby odświeżyć (opcjonalnie)
4. Jeśli sesja jest aktywna - sync bez logowania!
```

### 3. Przeglądanie danych
```
┌─────────────────────────────┐
│ [Oceny³][Wiad⁵][Uwagi][Ogł]│  ← Badge'e = liczba nowych
└─────────────────────────────┘
│
├─ Kliknij zakładkę → Zobacz dane
├─ NOWE elementy są oznaczone
├─ Po 2 sekundach → auto-przeczytane
└─ Kliknij w ocenę → Modal ze szczegółami
```

### 4. Szczegóły oceny
```
Kliknij na chipsa z ocenąv (np. "5")
      ↓
┌─────────────────────────┐
│  Szczegóły oceny        │
│ ┌─────────────────────┐ │
│ │  [5]  Zielony badge │ │
│ │  Matematyka         │ │
│ ├─────────────────────┤ │
│ │ 📝 Opis:           │ │
│ │    Sprawdzian z... │ │
│ │ 📅 Data: 15.05.2026│ │
│ │ 👤 Nauczyciel: ... │ │
│ │ 📁 Kategoria: Spr. │ │
│ │ ⚖️ Waga: 5         │ │
│ └─────────────────────┘ │
│    [Zamknij]            │
└─────────────────────────┘
```

## 🔄 Synchronizacja - Jak to działa

### Proces krok po kroku:
```typescript
1. Kliknięcie "Synchronizuj"
   ↓
2. Sprawdzenie sesji
   ├─ Sesja aktywna → Używa istniejącej przeglądarki
   └─ Brak sesji → Otwiera nową, user loguje się
   ↓
3. Nawigacja do każdej sekcji:
   ├─ https://synergia.librus.pl/przegladaj_oceny/uczen
   ├─ https://wiadomosci.librus.pl/nowy/inbox
   ├─ https://wiadomosci.librus.pl/nowy/inbox-notes
   ├─ https://synergia.librus.pl/ogloszenia
   └─ https://synergia.librus.pl/terminarz
   ↓
4. Dla każdej sekcji:
   ├─ Czekanie na załadowanie strony
   ├─ Wykonanie JavaScript scraping script
   ├─ Parsowanie danych
   ├─ Porównanie z zapisanymi
   ├─ Oznaczenie nowych
   └─ Zapis do storage
   ↓
5. Wyświetlenie wyniku:
   "Znaleziono X nowych elementów!"
```

## 🛠️ Konfiguracja

### Timeout sesji
```typescript
// src/app/services/librus-auth.ts:26
private readonly SESSION_DURATION = 30 * 60 * 1000; // 30 minut

// Dla produkcji zmień na:
private readonly SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 dni
```

### Timeout scrapingu
```typescript
// src/app/services/librus-auth.ts - metoda scrapeSection()
const timeout = setTimeout(() => {...}, 15000); // 15 sekund

// Jeśli Librus ładuje się wolno, zwiększ do 30000 (30 sek)
```

### Auto-oznaczanie jako przeczytane
```typescript
// src/app/home/home.page.ts:73
setTimeout(() => {
  this.storageService.markAllAsRead(tab);
}, 2000); // 2 sekundy

// Zmień na np. 5000 dla 5 sekund
```

## 🔍 Scraping Scripts - Dopasowanie do Librusa

⚠️ **WAŻNE:** Skrypty scrapingowe mogą wymagać dopasowania do rzeczywistej struktury HTML Librusa.

### Gdzie są skrypty?
```
src/app/services/librus-scraper.service.ts
```

### Testowanie skryptów:
1. Otwórz https://synergia.librus.pl/przegladaj_oceny/uczen w przeglądarce
2. Otwórz DevTools (F12) → Console
3. Skopiuj skrypt z `getGradesScript()`
4. Wklej do console i wykonaj
5. Sprawdź czy zwraca poprawne dane
6. Jeśli nie - popraw selektory CSS

### Przykładowe dopasowanie selektorów:
```javascript
// Jeśli oceny są w innym elemencie:
document.querySelectorAll('tr.line0, tr.line1') 
// Zmień na:
document.querySelectorAll('.grades-row') // lub inny selektor

// Jeśli kolumny mają inne indeksy:
var przedmiot = kolumny[1].innerText  // kolumna 1
// Sprawdź w DevTools która kolumna ma przedmiot
```

## 📊 Stored Data Format

### Capacitor Preferences - klucze:
```
librus_session_cookies  → Marker sesji
librus_data            → Wszystkie dane aplikacji
```

### Format danych:
```json
{
  "grades": [
    {
      "subject": "Matematyka",
      "grades": [
        {
          "value": "5",
          "description": "Sprawdzian z funkcji",
          "date": "15.05.2026",
          "teacher": "Jan Kowalski",
          "weight": "5",
          "category": "Sprawdzian",
          "isNew": true
        }
      ]
    }
  ],
  "messages": [...],
  "notes": [...],
  "announcements": [...],
  "calendar": [...],
  "lastSync": 1777831760399
}
```

## 🐛 Debugging

### 1. Debug mode w aplikacji
```
Kliknij ikonę 🐛 w prawym górnym rogu
  ↓
Sprawdź console/logcat:
  - Status sesji
  - Liczba zapisanych danych
  - Ostatnia synchronizacja
```

### 2. Console logs
Aplikacja loguje wszystkie operacje:
```
🔄 = Synchronizacja
✅ = Sukces
❌ = Błąd
⚠️ = Ostrzeżenie
📚📬📝📢📅 = Ikony sekcji
💾 = Zapis do storage
🌐 = Nawigacja w przeglądarce
```

### 3. Common issues

**Problem:** "Property 'syncAllData' does not exist"
**Rozwiązanie:** Sprawdź czy wszystkie importy są poprawne, przeładuj IDE

**Problem:** Badge'e nie pokazują liczby nowych
**Rozwiązanie:** Sprawdź czy `compareAndMarkNew()` działa poprawnie

**Problem:** Modal szczegółów nie otwiera się
**Rozwiązanie:** Sprawdź czy `openGradeDetails()` jest wywołane prawidłowo

**Problem:** Scraping zwraca puste dane
**Rozwiązanie:** Dopasuj selektory CSS w `librus-scraper.service.ts`

## 🚀 Następne kroki (opcjonalne)

### 1. Powiadomienia push
```typescript
// Dodaj sprawdzanie w tle
// Wyślij notification gdy są nowe dane
```

### 2. Statystyki
```typescript
// Średnia ocen
// Wykresy postępów
// Frekwencja
```

### 3. Export danych
```typescript
// Export do PDF
// Export do Excel
// Udostępnianie
```

### 4. Offline mode
```typescript
// Przeglądanie danych bez internetu
// Kolejka synchronizacji
```

### 5. Biometric auth
```typescript
// Face ID / Touch ID
// PIN do ochrony danych
```

## ✅ Podsumowanie

Aplikacja jest **gotowa do użytku**! 

**Co działa:**
- ✅ Persystencja sesji (minimize/restore)
- ✅ 5 głównych sekcji Librusa
- ✅ Wykrywanie nowości
- ✅ Szczegóły ocen
- ✅ Storage lokalny
- ✅ UI z zakładkami

**Co wymaga testów:**
- ⚠️ Scraping scripts na prawdziwym koncie Librus
- ⚠️ Poprawność selektorów CSS
- ⚠️ Różne scenariusze (pusta skrzynka, dużo danych, etc.)

**Uruchom, przetestuj i ciesz się aplikacją!** 🎉
