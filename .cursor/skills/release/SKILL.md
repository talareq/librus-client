---
name: release
description: >-
  Podbija semver w package.json (patch), commit z [publish-apk] i push na main,
  żeby Chain „Release debug APK” opublikował APK pod /releases/latest/download/librus-client.apk.
  Użyj gdy użytkownik chce wydać nową wersję APK, publish release, lub wymieni „skill release”.
---

# Release (APK przez [publish-apk])

## Kiedy stosować

Repozytorium **librus-client**: po pushu na `main` commita z **`[publish-apk]`** w treści, workflow **Build Android APK** → **Chain release after APK CI** woła **Release debug APK** z wersją z `package.json` z tego commita.

## Kroki (agent wykonuje w katalogu głównym repo)

1. **Odczytaj bieżącą wersję** (informuj użytkownika):
   - `node -p "require('./package.json').version"`
2. **Upewnij się, że drzewo git jest sensowne** (brak niezacommitowanych zmian poza tym, co zamierzasz w release, chyba że użytkownik chce je wcześniej zacommitować osobno).
3. **Podbij patch** bez automatycznego taga git (tag tworzy potem GitHub Actions przy release):
   ```bash
   npm version patch --no-git-tag-version
   ```
   Skrypt `version` w `package.json` zsynchronizuje iOS (`project.pbxproj`); dodaj do commita wszystkie zmienione pliki: `package.json`, `package-lock.json`, `ios/App/App.xcodeproj/project.pbxproj`.
4. **Odczytaj nową wersję** po podbiciu:
   - `node -p "require('./package.json').version"`
5. **Commit** — treść **musi zawierać** dosłownie `[publish-apk]`:
   ```text
   chore: bump version do X.Y.Z [publish-apk]
   ```
   (wstaw faktyczne `X.Y.Z` z kroku 4).
6. **Push** (jeśli środowisko ma dostęp do remote):
   ```bash
   git push origin main
   ```
   Jeśli push się nie uda (np. SSH), podaj użytkownikowi dokładnie te komendy.

## Czego nie robić w tym flow

- **Nie** twórz lokalnego tagu `v*` dla tego flow — łańcuch opiera się o `workflow_dispatch` i wersję z commita.
- **Nie** umieszczaj `[skip ci]` w commicie release — **Build Android APK** ma się uruchomić (wyjątek: treść z `[skip ci]` celowo pomija build na pushu).

## Po stronie GitHub

- **Actions**: sprawdź **Build Android APK**, potem **Chain release after APK CI**, potem **Release debug APK**.
- APK pod stałym linkiem: `https://github.com/<owner>/librus-client/releases/latest/download/librus-client.apk`
- Po publikacji release może ruszyć **Bump version after release** (bot podbija `main` o kolejny patch — to normalne).

## Alternatywa (bez [publish-apk])

Release wyłącznie przez **push taga** `v*` — wtedy obowiązuje workflow **Release debug APK** na `on.push.tags`; osobna procedura, nie ten skill.
