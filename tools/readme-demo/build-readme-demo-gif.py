#!/usr/bin/env python3
"""
Build README demo GIF from phone screenshots: redact PII (pixelacja / Gaussian blur gdzie indziej),
normalize size, emit animated GIF.

Na potrzeby **jednego** README GIF-a: ekrany „Wiadomości” i „Uwagi” zamazują **konkretne frazy imion
i nazwisk** (lista w skrypcie) — pozycje z **Tesseract OCR** (lang `pol`), potem pikselacja prostokąta.
Wymaga binariów Tesseract + pakietu językowego pol oraz `pip install pytesseract`.
(Żeby zainstalować na macOS: `brew install tesseract tesseract-lang`.)

Inne klatki (np. ogłoszenia) nadal mogą używać redakcji „pasmowej” z `--blur`.

Dependencies: Pillow, pytesseract, system `tesseract` (+ `pol` traineddata).

Example:
  python3 tools/readme-demo/build-readme-demo-gif.py \\
    --out docs/readme-assets/librus-client-demo.gif

  python3 tools/readme-demo/build-readme-demo-gif.py --blur 26

  python3 tools/readme-demo/build-readme-demo-gif.py --transition-steps 5 --transition-ms 80
"""

from __future__ import annotations

import argparse
import difflib
import re
import unicodedata
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

# Nadpisywane z CLI w `main()`.
REDACTION_BLUR_RADIUS = 24

# --- Ten jeden demo-GIF: dokładne frazy do wykrycia i zapikselowania (Wiadomości + Uwagi). ---
README_DEMO_PII_PHRASES: tuple[str, ...] = (
    "Majerek Izabela",
    "Malada Bożena",
    "Nowak Katarzyna",
    "Jarosz Diana",
    "Regucka Ilona",
    "Gałuszka Pola",
    "Gałuszka Pola, 2b SP 134",
    "2b SP 134",
    "Curyło Agata",
    "Mezglewska Sylwia",
)

TESSERACT_LANG = "pol"

_README_DEMO_OCR_AVAILABLE: bool | None = None


def redact_region_pixelate(
    img: Image.Image,
    box: tuple[int, int, int, int],
    *,
    factor: int = 8,
) -> None:
    """Zamazanie bez „halo”: mocna pikselacja (cienkie pasmo → mały `fh`)."""
    x0, y0, x1, y1 = box
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(img.width, x1)
    y1 = min(img.height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    crop = img.crop((x0, y0, x1, y1))
    cw, ch = crop.size
    f = max(5, min(16, factor))
    fw = max(1, cw // f)
    fh = max(1, ch // max(2, (f + 2) // 3))
    res = Image.Resampling.NEAREST
    pixelated = crop.resize((fw, fh), res).resize((cw, ch), res)
    img.paste(pixelated, (x0, y0))


def redact_region_blur(
    img: Image.Image,
    box: tuple[int, int, int, int],
    *,
    radius: int | None = None,
    second_pass: bool = True,
) -> None:
    """Rozmycie Gaussa na wycinku. Przy małej wysokości wycinka użyj małego `radius`, inaczej rozmycie rozlewa się na tytuły."""
    x0, y0, x1, y1 = box
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(img.width, x1)
    y1 = min(img.height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    crop = img.crop((x0, y0, x1, y1))
    r = REDACTION_BLUR_RADIUS if radius is None else radius
    blurred = crop.filter(ImageFilter.GaussianBlur(r))
    if second_pass and r >= 12:
        blurred = blurred.filter(ImageFilter.GaussianBlur(max(3, r // 5)))
    img.paste(blurred, (x0, y0))


def _blur_y_bands(
    im: Image.Image,
    y_fracs: list[tuple[float, float]],
    x0f: float = 0.06,
    x1f: float = 0.88,
    pad_y: int = 2,
    *,
    blur_radius: int | None = None,
    blur_second_pass: bool = True,
) -> None:
    """Pionowe pasma jako ułamek wysokości obrazu (wykalibrowane na ~400×810 px)."""
    w, h = im.size
    for ys, ye in y_fracs:
        y0 = max(0, int(ys * h) - pad_y)
        y1 = min(h, int(ye * h) + pad_y)
        redact_region_blur(
            im,
            (int(w * x0f), y0, int(w * x1f), y1),
            radius=blur_radius,
            second_pass=blur_second_pass,
        )


def _ocr_import_check() -> None:
    global _README_DEMO_OCR_AVAILABLE
    if _README_DEMO_OCR_AVAILABLE is True:
        return
    try:
        import pytesseract  # noqa: F401
        from pytesseract import Output  # noqa: F401
    except ImportError as e:
        raise SystemExit(
            "Brak modułu pytesseract. Zainstaluj: pip install pytesseract\n"
            "oraz binarkę Tesseract (np. macOS: brew install tesseract tesseract-lang)."
        ) from e
    _README_DEMO_OCR_AVAILABLE = True


def _fold_chars(s: str) -> str:
    """Porównywanie tokenów OCR mimo drobnych różnic diakrytyków."""
    n = unicodedata.normalize("NFKD", s)
    return "".join(c for c in n if unicodedata.category(c) != "Mn").casefold()


def _token_normalize(word: str) -> str:
    w = re.sub(r"[^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+", "", word, flags=re.UNICODE)
    return _fold_chars(w)


def _is_junk_ocr_token(norm: str) -> bool:
    if not norm:
        return True
    if norm.isdigit():
        return True
    if len(norm) == 1 and norm in ".,|":
        return True
    return False


def _token_match(ocr_t: str, phrase_t: str) -> bool:
    if ocr_t == phrase_t:
        return True
    # Unikaj „Maj” → „Majerek”: krótki prefiks na długim tokenie daje zły bbox (Rowerowy Maj).
    if len(phrase_t) >= 4 and len(ocr_t) >= 3 and phrase_t.startswith(ocr_t):
        if not (len(ocr_t) < 4 and len(phrase_t) >= len(ocr_t) + 3):
            return True
    if len(ocr_t) >= 4 and len(phrase_t) >= 3 and ocr_t.startswith(phrase_t):
        return True
    # „Mezglewiska” / „tzabela” vs „Mezglewska” / „Izabela” itd.
    lo = min(len(ocr_t), len(phrase_t))
    if lo >= 6 and difflib.SequenceMatcher(None, ocr_t, phrase_t).ratio() >= 0.85:
        return True
    return False


def _phrase_subsequence_spans(word_entries: list[dict], phrase: str) -> list[tuple[int, int]]:
    """
    Fraza jako podciąg słów OCR (pomiń śmieci typu „2”, „8,”); tolerancja na skróty („Katarz”).
    """
    phrase_tokens = [_token_normalize(x) for x in phrase.split()]
    phrase_tokens = [t for t in phrase_tokens if t]
    if not phrase_tokens:
        return []
    filt_idx: list[int] = []
    filt_tok: list[str] = []
    for i, e in enumerate(word_entries):
        tn = _token_normalize(e["text"])
        if _is_junk_ocr_token(tn):
            continue
        filt_idx.append(i)
        filt_tok.append(tn)
    spans: list[tuple[int, int]] = []
    seen_span: set[tuple[int, int]] = set()
    m = len(phrase_tokens)
    n = len(filt_tok)
    for start in range(n):
        pi = 0
        first_orig: int | None = None
        last_orig: int | None = None
        for j in range(start, n):
            if _token_match(filt_tok[j], phrase_tokens[pi]):
                if first_orig is None:
                    first_orig = filt_idx[j]
                last_orig = filt_idx[j]
                pi += 1
                if pi == m:
                    assert first_orig is not None and last_orig is not None
                    sp = (first_orig, last_orig)
                    if sp not in seen_span:
                        seen_span.add(sp)
                        spans.append(sp)
                    break
    return spans


def _entry_vertical_span(entries: list[dict], lo: int, hi: int) -> int:
    chunk = entries[lo : hi + 1]
    ys = [int(e["top"]) for e in chunk]
    ye = [int(e["top"] + e["height"]) for e in chunk]
    return max(ye) - min(ys)


def _ocr_enhanced_for_tesseract(im: Image.Image, *, scale: int = 2) -> Image.Image:
    """Szare małe etykiety na wąskich zrzutach: 2× + grayscale + autocontrast (tylko wejście do OCR)."""
    big = im.resize((im.width * scale, im.height * scale), Image.Resampling.LANCZOS)
    g = ImageOps.grayscale(big)
    g = ImageOps.autocontrast(g, cutoff=1)
    return Image.merge("RGB", (g, g, g))


def _ocr_needs_enhanced_pass(im: Image.Image) -> bool:
    return min(im.width, im.height) < 560 or im.width < 440


def _collect_pii_tesseract_words(
    im: Image.Image,
    *,
    lang: str,
    min_conf: int,
    dual_psm6: bool,
) -> list[dict]:
    """Łączy OCR na oryginale i (dla małych obrazów) na wersji wzmocnionej; współrzędne → przestrzeń `im`."""
    merged: list[dict] = []
    near = 8

    def absorb(run_im: Image.Image, coord_scale: float) -> None:
        nonlocal merged, near
        w = _tesseract_word_boxes(run_im, lang=lang, min_conf=min_conf)
        if dual_psm6:
            w = _merge_ocr_word_boxes(
                w,
                _tesseract_word_boxes(run_im, lang=lang, config="--psm 6", min_conf=min_conf),
                near_px=near,
            )
        inv = 1.0 / coord_scale
        for x in w:
            x["left"] *= inv
            x["top"] *= inv
            x["width"] *= inv
            x["height"] *= inv
        if not merged:
            merged = w
        else:
            merged = _merge_ocr_word_boxes(merged, w, near_px=max(near, 12))

    absorb(im, 1.0)
    if _ocr_needs_enhanced_pass(im):
        near = 12
        absorb(_ocr_enhanced_for_tesseract(im, scale=2), 2.0)
    return merged


def _tesseract_word_boxes(
    im: Image.Image,
    *,
    lang: str,
    config: str = "",
    min_conf: int = 10,
) -> list[dict]:
    import pytesseract
    from pytesseract import Output

    # Nie zwiększaj na siłę: przy ~400 px szerokości upscale często psuje `image_to_data` (znikają szare nazwiska).
    scale = 1
    src = im
    if scale > 1:
        src = im.resize((im.width * scale, im.height * scale), Image.Resampling.LANCZOS)
    try:
        data = pytesseract.image_to_data(
            src, lang=lang, output_type=Output.DICT, config=config
        )
    except pytesseract.TesseractNotFoundError as e:
        raise SystemExit(
            "Nie znaleziono Tesseract w PATH. macOS: brew install tesseract tesseract-lang"
        ) from e
    words: list[dict] = []
    n = len(data["text"])
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        if not txt:
            continue
        try:
            conf = int(float(data["conf"][i]))
        except (TypeError, ValueError):
            conf = 0
        if conf < min_conf:
            continue
        l, t, bw, bh = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        if bw <= 1 or bh <= 1:
            continue
        line_key = (data["page_num"][i], data["block_num"][i], data["par_num"][i], data["line_num"][i])
        words.append(
            {
                "text": txt,
                "left": l / scale,
                "top": t / scale,
                "width": bw / scale,
                "height": bh / scale,
                "line_key": line_key,
            }
        )
    return words


def _merge_ocr_word_boxes(primary: list[dict], extra: list[dict], *, near_px: int = 8) -> list[dict]:
    """Łączy dwa przebiegi OCR; pomija duplikat (to samo słowo w tym samym miejscu)."""
    out = list(primary)
    for w in extra:
        l, t, txt = w["left"], w["top"], w["text"]
        tn = _token_normalize(txt)
        if any(
            abs(v["left"] - l) <= near_px
            and abs(v["top"] - t) <= near_px
            and _token_normalize(v["text"]) == tn
            for v in out
        ):
            continue
        out.append(w)
    return out


def _entry_box(entries: list[dict], lo: int, hi: int, *, pad: int) -> tuple[int, int, int, int]:
    xs0 = min(int(e["left"]) for e in entries[lo : hi + 1])
    ys0 = min(int(e["top"]) for e in entries[lo : hi + 1])
    xs1 = max(int(e["left"] + e["width"]) for e in entries[lo : hi + 1])
    ys1 = max(int(e["top"] + e["height"]) for e in entries[lo : hi + 1])
    return (xs0 - pad, ys0 - pad, xs1 + pad, ys1 + pad)


def redact_readme_demo_pii_literals(
    im: Image.Image,
    *,
    ocr_lang: str | None = None,
    ocr_min_conf: int = 10,
    ocr_dual_psm6: bool = True,
) -> None:
    """
    Lista `README_DEMO_PII_PHRASES`: Tesseract (w tym drugi `--psm 6` i dla małych PNG — wzmocniony podgląd),
    dopasowanie fraz w kolejności czytania z ograniczeniem pionowym (żeby nie łączyć dwóch kart),
    potem pikselacja.
    """
    _ocr_import_check()
    lang = ocr_lang or TESSERACT_LANG
    words = _collect_pii_tesseract_words(im, lang=lang, min_conf=ocr_min_conf, dual_psm6=ocr_dual_psm6)
    # `(top, left)`, nie środek bboxa — inne wysokości słów (np. nazwisko / imię) psuły kolejność „Regucka” przed „Ilona”.
    line_words = sorted(words, key=lambda w: (w["top"], w["left"]))

    pf = max(7, min(16, REDACTION_BLUR_RADIUS // 2 + 3))
    pad = max(8, REDACTION_BLUR_RADIUS // 5) + 6
    seen: set[tuple[int, int, int, int]] = set()
    phrases_sorted = sorted(README_DEMO_PII_PHRASES, key=lambda p: len(p.split()), reverse=True)

    for phrase in phrases_sorted:
        max_v = max(62, 26 * len(phrase.split()))
        for lo, hi in _phrase_subsequence_spans(line_words, phrase):
            if _entry_vertical_span(line_words, lo, hi) > max_v:
                continue
            box = _entry_box(line_words, lo, hi, pad=pad)
            if box not in seen:
                seen.add(box)
                redact_region_pixelate(im, box, factor=pf)


def redact_ogloszenia(im: Image.Image) -> None:
    """Ogłoszenia: pojedyncza linia z imieniem i nazwiskiem autora karty."""
    _blur_y_bands(
        im,
        [
            (0.435, 0.451),
            (0.629, 0.642),
        ],
        x0f=0.06,
        x1f=0.92,
        pad_y=2,
    )


REDACT_BY_STEM = {
    "image-3fe87569-e83c-4a14-bbf0-1b30780b701d": redact_readme_demo_pii_literals,
    "image-05f5ac00-b1f2-4b01-8e53-6253219d66bd": redact_readme_demo_pii_literals,
    "image-3e58b799-5bfc-47e6-8fc8-7d62f30bfc92": redact_readme_demo_pii_literals,
    "image-7017db14-2f43-451b-b99f-d3f1a30330c6": redact_readme_demo_pii_literals,
    "image-9ddac575-345c-4bdf-ba6c-476ceae953be": redact_readme_demo_pii_literals,
    "image-13d38171-9290-4cc2-837c-bc2a2aaa81a8": redact_readme_demo_pii_literals,
    "image-af101522-de4c-4ce1-94df-c535048f9a8c": redact_readme_demo_pii_literals,
    "image-b842e8ec-0303-4e2f-b6dd-2a070de168d7": redact_readme_demo_pii_literals,
    "image-8f1115c2-f19e-47b6-867a-56ae06404989": redact_ogloszenia,
}


def load_rgb(path: Path) -> Image.Image:
    im = Image.open(path)
    if im.mode == "RGBA":
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        return bg
    return im.convert("RGB")


def fit_canvas(im: Image.Image, canvas: tuple[int, int], bg: tuple[int, int, int] = (248, 248, 248)) -> Image.Image:
    cw, ch = canvas
    contained = ImageOps.contain(im, (cw, ch), Image.Resampling.LANCZOS)
    out = Image.new("RGB", (cw, ch), bg)
    ox = (cw - contained.width) // 2
    oy = (ch - contained.height) // 2
    out.paste(contained, (ox, oy))
    return out


def expand_crossfade(
    frames: list[Image.Image],
    transition_steps: int,
    transition_ms: int,
    hold_ms: int,
) -> tuple[list[Image.Image], list[int]]:
    """
    Wstawia między kolejnymi klatkami keyframe kroki Image.blend (crossfade).
    Format GIF nie ma natywnych tweenów — symulacja = dodatkowe klatki + krótszy czas.
    """
    if transition_steps <= 0 or len(frames) < 2:
        return frames, [hold_ms] * len(frames)

    out: list[Image.Image] = []
    durs: list[int] = []
    for i, fr in enumerate(frames):
        if i > 0:
            prev = frames[i - 1]
            for s in range(1, transition_steps + 1):
                t = s / (transition_steps + 1)
                out.append(Image.blend(prev, fr, t))
                durs.append(transition_ms)
        out.append(fr)
        durs.append(hold_ms)
    return out, durs


def default_frame_paths(assets_dir: Path) -> list[Path]:
    names = [
        "image-5c0bf8ca-b581-435a-83ae-4a4f6cb7ce37.png",
        "image-aa5bb028-b628-4a38-af3e-9d2874bf4040.png",
        "image-fafd4398-9521-4afb-b523-87240b102934.png",
        "image-4e9945e7-9f5b-4a0d-997a-bd949bb3808a.png",
        "image-3fe87569-e83c-4a14-bbf0-1b30780b701d.png",
        "image-9ddac575-345c-4bdf-ba6c-476ceae953be.png",
        "image-8f1115c2-f19e-47b6-867a-56ae06404989.png",
        "image-e433e936-7a0d-481b-a7d2-9d7153312577.png",
    ]
    return [assets_dir / n for n in names]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--assets",
        type=Path,
        default=None,
        help="Folder ze screenshotami PNG (domyślnie: ~/.cursor/projects/.../assets)",
    )
    ap.add_argument("--out", type=Path, default=Path("docs/readme-assets/librus-client-demo.gif"))
    ap.add_argument("--width", type=int, default=480)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--duration-ms", type=int, default=2200, help="Czas postoju na każdej klatce źródłowej (po przejściu).")
    ap.add_argument(
        "--transition-steps",
        type=int,
        default=5,
        help="Liczba klatek pośrednich (crossfade) między każdą parą ekranów; 0 = wyłączone skoki.",
    )
    ap.add_argument(
        "--transition-ms",
        type=int,
        default=75,
        help="Czas trwania jednej klatki pośredniej w ms (domyślnie 75).",
    )
    ap.add_argument(
        "--blur",
        type=int,
        default=24,
        help="Promień rozmycia Gaussa w strefach redakcji (większy = mniej czytelny tekst, domyślnie 24).",
    )
    ap.add_argument(
        "--ocr-lang",
        default="pol",
        help="Tesseract lang dla redakcji fraz PII (Wiadomości/Uwagi), np. pol lub pol+eng.",
    )
    ap.add_argument(
        "--ocr-min-conf",
        type=int,
        default=10,
        help="Minimalna pewność Tesseract (0–100) dla słów używanych do dopasowania fraz; niżej = więcej dopasowań, ryzyko szumu.",
    )
    ap.add_argument(
        "--ocr-no-dual-psm",
        action="store_true",
        help="Wyłącz drugi przebieg OCR z --psm 6 (szybciej, bywa mniej odporne na błędy odczytu nazwisk).",
    )
    args = ap.parse_args()

    global REDACTION_BLUR_RADIUS
    REDACTION_BLUR_RADIUS = max(1, min(80, args.blur))

    assets = args.assets
    if assets is None:
        assets = Path.home() / ".cursor/projects/Users-martusia-librus-client/assets"

    frames: list[Image.Image] = []
    canvas = (args.width, args.height)

    for path in default_frame_paths(assets):
        if not path.exists():
            raise SystemExit(f"Brak pliku: {path} (podaj --assets …)")
        im = load_rgb(path)
        stem = path.stem
        redactor = REDACT_BY_STEM.get(stem)
        if redactor is redact_readme_demo_pii_literals:
            redact_readme_demo_pii_literals(
                im,
                ocr_lang=args.ocr_lang,
                ocr_min_conf=max(0, min(100, args.ocr_min_conf)),
                ocr_dual_psm6=not args.ocr_no_dual_psm,
            )
        elif redactor:
            redactor(im)
        frames.append(fit_canvas(im, canvas))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    if not frames:
        raise SystemExit("Brak klatek")

    frames, durations = expand_crossfade(
        frames,
        max(0, args.transition_steps),
        max(20, args.transition_ms),
        max(100, args.duration_ms),
    )

    first, *rest = frames
    first.save(
        args.out,
        save_all=True,
        append_images=rest,
        duration=durations,
        loop=0,
        optimize=False,
        disposal=2,
    )
    print(f"Zapisano GIF: {args.out.resolve()} ({len(frames)} klatek, przejście: {args.transition_steps} kroków × {args.transition_ms} ms)")


if __name__ == "__main__":
    main()
