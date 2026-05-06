# Rozbudowana Aplikacja Librus Client

## 🎯 Zaimplementowane funkcjonalności

### 1. **Architektura danych**
- Modele TypeScript dla wszystkich sekcji
- Storage service z Capacitor Preferences
- Automatyczne wykrywanie nowych elementów
- Porównywanie z poprzednią synchronizacją

### 2. **Sekcje aplikacji**
#### ✅ Oceny (Grades)
- Lista ocen po przedmiotach
- Szczegóły oceny (opis, data, nauczyciel, waga, kategoria)
- Modal z pełnymi informacjami
- Kolorowanie według wartości
- Oznaczenie "NOWE" dla nowych ocen

#### ✅ Wiadomości (Messages)  
- Skrzynka odbiorcza z https://wiadomosci.librus.pl/nowy/inbox
- Status przeczytane/nieprzeczytane
- Oznaczenie nowych wiadomości
- Wyświetlanie nadawcy, tematu, daty

#### ✅ Uwagi (Notes)
- Uwagi z https://wiadomosci.librus.pl/nowy/inbox-notes
- Informacje o nauczycielu, treści, kategorii
- Oznaczenie nowych uwag

#### ✅ Ogłoszenia (Announcements)
- Ogłoszenia z https://synergia.librus.pl/ogloszenia
- Tytuł, treść, autor, data
- Format karty (card) dla lepszej czytelności

#### ✅ Terminarz (Calendar)
- Wydarzenia z https://synergia.librus.pl/terminarz
- Tytuł, opis, data, typ wydarzenia
- Wyróżnienie sprawdzianów

### 3. **UI/UX**
- **System zakładek (Tabs)** - łatwa nawigacja między sekcjami
- **Badge'y z liczbą nowych** - natychmiastowa informacja o nowościach
- **Auto-oznaczanie jako przeczytane** - po 2 sekundach oglądania zakładki
- **Kolorowanie ocen** - wizualna ocena wyników
- **Modal szczegółów** - pełne informacje o ocenie po kliknięciu
- **Responsywny design** - działa na różnych urządzeniach

### 4. **Funkcje pomocnicze**
- Synchronizacja wszystkich sekcji jednym przyciskiem
- Debug mode do sprawdzania stanu
- Wylogowanie z czyszczeniem wszystkich danych
- Status sesji w nagłówku
- Komunikaty o sukcesie/błędach

## 🔧 Następne kroki - Co trzeba dokończyć

### 1. **Integracja z LibrusAuthService**
Dodać metodę `syncAllData()` która:
- Nawiguje do każdej sekcji Librusa
- Uruchamia odpowiedni skrypt scrapingowy
- Porównuje z zapisanymi danymi
- Zwraca statystyki (ile nowych elementów)

### 2. **Scraping scripts - dopracowanie**
Skrypty scrapingowe mogą wymagać dopasowania do rzeczywistej struktury HTML Librusa:
- Sprawdzić selektory CSS na prawdziwych stronach
- Dodać obsługę różnych formatów dat
- Obsłużyć edge case'y (puste strony, błędy)

### 3. **Nawigacja w InAppBrowser**
LibrusAuthService musi:
- Otwierać różne URL'e Librusa
- Czekać na załadowanie każdej strony
- Wykonywać scraping
- Przechodzić do następnej sekcji

### 4. **Testy**
- Przetestować na prawdziwym koncie Librus
- Sprawdzić czy selektory działają
- Zweryfikować wykrywanie nowych elementów
- Przetestować różne scenariusze (pusta skrzynka, dużo danych, etc.)

## 📋 Struktura plików

```
src/app/
├── models/
│   └── librus-data.models.ts      # Modele danych
├── services/
│   ├── librus-auth.ts             # Główny serwis (wymaga rozszerzenia)
│   ├── librus-storage.service.ts # Zarządzanie storage
│   └── librus-scraper.service.ts # Skrypty scrapingowe
└── home/
    ├── home.page.ts               # Logika UI
    ├── home.page.html             # Template z zakładkami
    └── home.page.scss             # Style
```

## 🎨 Design Decisions

### Dlaczego taby zamiast osobnych stron?
- Szybsza nawigacja (bez ładowania)
- Lepsze UX dla mobilnej aplikacji
- Łatwiejsze zarządzanie stanem
- Badge'y zawsze widoczne

### Dlaczego Capacitor Preferences?
- Natywny storage (encrypted na iOS)
- Prosty API
- Synchroniczny/asynchroniczny dostęp
- Przetrwa reinstalację (opcjonalnie)

### Dlaczego scraping zamiast API?
- Librus nie ma publicznego API
- InAppBrowser daje dostęp do zalogowanej sesji
- Można pobrać wszystko co widzi użytkownik
- Obsługuje Cloudflare protection

## 🚀 Przykładowy flow użytkownika

1. **Otwarcie app** → Załadowanie zapisanych danych
2. **Kliknięcie "Synchronizuj"** → Logowanie (jeśli potrzebne)
3. **Scraping wszystkich sekcji** → Porównanie z zapisem
4. **Wyświetlenie badge'ów** → "5 nowych wiadomości"
5. **Kliknięcie zakładki** → Pokazanie danych z oznaczeniem "NOWE"
6. **Po 2 sekundach** → Auto-oznaczenie jako przeczytane
7. **Kliknięcie w ocenę** → Modal ze szczegółami

## 📱 Screenshots mockup

```
┌─────────────────────────────┐
│ Librus Client        [🐛][⚙]│
│ [✓ Zalogowany] [🔄 Sync][🚪]│
├─────────────────────────────┤
│ Zsynchronizowano! 5 nowych  │
├─────────────────────────────┤
│[Oceny³][Wiad⁵][Uwagi][Ogł][T]│
├─────────────────────────────┤
│ 📬 Wiadomości               │
│                              │
│ ┌──────────────────────────┐│
│ │ 📧 Wywiadówka [NOWE]     ││
│ │ Od: Jan Kowalski         ││
│ │ 15.05.2026               ││
│ └──────────────────────────┘│
│                              │
│ ┌──────────────────────────┐│
│ │ 📧 Wycieczka             ││
│ │ Od: Anna Nowak           ││
│ │ 14.05.2026               ││
│ └──────────────────────────┘│
└─────────────────────────────┘
```

## 🎯 Gotowe!

Architektura jest kompletna. Teraz trzeba tylko:
1. Zintegrować scraping scripts z LibrusAuthService
2. Dodać nawigację między stronami w InAppBrowser
3. Przetestować na prawdziwych danych

Kod jest modularny, testowalny i łatwy do rozszerzenia o kolejne funkcje!
