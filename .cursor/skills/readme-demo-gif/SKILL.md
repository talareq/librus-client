---
name: readme-demo-gif
description: >-
  Builds a README documentation GIF from mobile screenshots with PII redaction
  (OCR phrase match, pixelation, blur bands). Use when the user adds or updates
  demo animation in librus-client, README screenshots, or asks about
  tools/readme-demo/build-readme-demo-gif.py, Tesseract, or demo privacy for
  committed assets.
---

# GIF demonstracyjny do README (screenshoty + redakcja)

## Kiedy stosować

- Użytkownik chce **GIF-a** z kilku **zrzutów ekranu** (Android / iOS) do `README.md` lub podobnego pliku.
- Na zrzutach są **dane wrażliwe** (np. nauczyciele, uczniowie, klasa, login) — trzeba je **zakryć przed commitem**.
- Nie polegaj wyłącznie na „rozmywaniu w aplikacji przy nagrywaniu”: do materiałów w repo użyj **edycji obrazu** lub skryptu.

## Zalecany workflow w tym repozytorium

1. **Zależności:** `pip install Pillow pytesseract` oraz binarka **Tesseract** z pakietem językowym **pol** (np. macOS: `brew install tesseract tesseract-lang`).

2. **Skrypt:** `tools/readme-demo/build-readme-demo-gif.py` (uruchamiaj z katalogu głównego repozytorium).

   - Domyślnie szuka PNG w `~/.cursor/projects/<projekt>/assets` (nadpisanie: `--assets /ścieżka/do/png`).
   - Kolejność klatek: `default_frame_paths` w skrypcie — przy nowej narracji zmień listę lub pliki.
   - **Redakcja po stemie pliku:** `REDACT_BY_STEM` (np. wiadomości / uwagi → OCR + pikselacja wg `README_DEMO_PII_PHRASES`; ogłoszenia → pasma rozmycia).
   - **Wyjście:** `docs/readme-assets/librus-client-demo.gif` (typowo `--out docs/readme-assets/librus-client-demo.gif`).
   - **Przejścia:** `--transition-steps`, `--transition-ms`; ostre cięcia: `--transition-steps 0`.
   - **Fine-tuning OCR:** `--ocr-min-conf`, `--ocr-no-dual-psm`, `--ocr-lang`.

3. **Przykład**

   ```bash
   cd /path/to/librus-client
   python3 tools/readme-demo/build-readme-demo-gif.py \
     --assets ~/.cursor/projects/<projekt>/assets \
     --out docs/readme-assets/librus-client-demo.gif \
     --blur 28
   ```

4. **README:** osadź GIF względną ścieżką, np. `![Opis](docs/readme-assets/librus-client-demo.gif)`; krótko napisz, że PII zostało zredagowane.

5. **Przed `git push`:** otwórz GIF lokalnie; przy nowych układach UI dopisz frazy, `REDACT_BY_STEM` lub — dla ogłoszeń — skoryguj `y_fracs` w `redact_ogloszenia`.

## Alternatywy

- ImageMagick, GIMP/Photopea + FFmpeg / Pillow do złożenia klatek — gdy skrypt nie pasuje.

## Prywatność

- Zwiększ `--blur` na ogłoszeniach lub w razie potrzeby zamień pasma na pikselację.
- Nie commituj surowych zrzutów z PII obok wersji publicznej w tym samym commicie, jeśli historia ma być czysta.
