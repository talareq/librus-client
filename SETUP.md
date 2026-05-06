# Librus Client - Quick Setup Guide

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Add Platform (jeśli nie została jeszcze dodana)

```bash
npx cap add android
# lub
npx cap add ios
```

### 3. Sync Capacitor

```bash
npx cap sync
```

### 4. Run on Device

```bash
# Android
npx cap open android

# iOS
npx cap open ios
```

Następnie zbuduj i uruchom aplikację z Android Studio lub Xcode.

## 📱 Jak używać

### Pierwsze uruchomienie:
1. Otwórz aplikację
2. Kliknij **"ZALOGUJ I POBIERZ OCENY"**
3. Zaloguj się w oknie przeglądarki Librus
4. Twoje dane zostaną pobrane i sesja zapisana

### Kolejne uruchomienia:
1. Otwórz aplikację
2. Kliknij **"ODŚWIEŻ OCENY"**
3. Dane zostaną pobrane automatycznie bez logowania! 🎉

### Wylogowanie:
- Kliknij **"WYLOGUJ"** aby usunąć zapisaną sesję

## 🔐 Bezpieczeństwo Sesji

- Sesja jest zapisana lokalnie na urządzeniu
- Automatycznie wygasa po **30 dniach**
- Można wylogować się ręcznie w każdej chwili
- Cookies są szyfrowane przez system operacyjny

## 🛠️ Technologie

- **Ionic Angular** - Framework aplikacji mobilnej
- **Capacitor** - Natywna warstwa abstrakcji
- **InAppBrowser** - Bezpieczne logowanie w WebView
- **Capacitor Preferences** - Trwała pamięć dla sesji
- **CapacitorCookies** - Zarządzanie cookies

## 📖 Dokumentacja

Szczegółowa dokumentacja techniczna dostępna w [SESSION_PERSISTENCE.md](./SESSION_PERSISTENCE.md)

## 🐛 Troubleshooting

### Problem: Aplikacja prosi o logowanie mimo zapisanej sesji
- Sesja mogła wygasnąć po stronie serwera Librus
- Spróbuj wylogować i zalogować ponownie

### Problem: Nie widzę swoich ocen
- Sprawdź połączenie internetowe
- Upewnij się, że Librus działa (spróbuj w przeglądarce)

### Problem: Aplikacja się zawiesza
- Zamknij i uruchom ponownie
- Jeśli problem persystuje, kliknij "WYLOGUJ" i zaloguj się ponownie

## 📝 Development

### Struktur projektu:
```
src/
├── app/
│   ├── services/
│   │   └── librus-auth.ts     # Główna logika sesji
│   └── home/
│       ├── home.page.ts       # Komponent główny
│       └── home.page.html     # UI
└── main.ts
```

### Przydatne komendy:

```bash
# Dev server (tylko web, bez persystencji)
npm start

# Build produkcyjny
npm run build

# Sync po zmianach
npx cap sync

# Live reload na urządzeniu Android
npx cap run android -l --external

# Linting
npm run lint
```

## 🎯 Roadmap

- [ ] Biometric authentication (Touch ID/Face ID)
- [ ] Background sync
- [ ] Push notifications dla nowych ocen
- [ ] Offline mode
- [ ] Multi-account support
- [ ] Więcej widoków (frekwencja, plan lekcji, etc.)

## 📄 Licencja

Ten projekt to proof-of-concept dla edukacyjnego użytku.

## ⚠️ Disclaimer

Ta aplikacja nie jest oficjalnym klientem Librus. Używaj na własną odpowiedzialność.
