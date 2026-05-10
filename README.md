# Librus Client · Unofficial Synergia Companion

![Ionic](https://img.shields.io/badge/Ionic-3880FF?style=flat&logo=ionic&logoColor=white)
![Angular](https://img.shields.io/badge/Angular-DD0031?style=flat&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?style=flat&logo=capacitor&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=flat&logo=android&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-000000?style=flat&logo=ios&logoColor=white)

**Proof-of-concept mobile client** that aggregates key **Librus / Synergia** information in a single Ionic app—without an official public API. Designed as a **portfolio piece** to demonstrate systems thinking, integration under constraints, and pragmatic mobile architecture.

---

## Project Overview

This application lets a signed-in user sync and browse **grades** (with Polish school-year semantics), **announcements**, **timetable**, **messages**, and **notes** by reusing the same authentication and page flows as the vendor web apps. Data is normalized into TypeScript models, persisted on-device, and presented in a consolidated **Ionic** shell with tabbed navigation, “new item” indicators, and drill-down modals.

---

## Demo

The animation below walks through a condensed flow: **grades with an active session**, **embedded-browser login**, **the sync screen**, and **messages, notes, announcements, and timetable**. Frames that contained sensitive data (e.g. teachers or identifiers in lists) were **redacted** before the GIF was committed to the repository.

![App demo — grades, login, sync, tabs](docs/readme-assets/librus-client-demo.gif)

*Built from device screenshots. Regenerate with `python3 tools/readme-demo/build-readme-demo-gif.py` (**Pillow**, **pytesseract**, system **Tesseract** with Polish trained data, e.g. `brew install tesseract tesseract-lang`). Messages and notes screens redact a fixed list of name phrases from `README_DEMO_PII_PHRASES` in the script (OCR → pixelate). `--blur` affects announcement bands only; crossfades are on by default (`--transition-steps 0` for hard cuts).*

---

## Key Features

- **Session-aware sync** — Uses an embedded browser workflow compatible with vendor login and multi-host SSO (Synergia vs. dedicated messaging host).
- **Grades** — Scrapes dziennik-style tables, parses rich tooltips/dates, derives stable `dateISO`, and groups by **semester** (school-year rules, Semester II surfaced first in the UI).
- **Announcements & calendar** — DOM extraction from Synergia surfaces; calendar events enriched with contextual month hints for ambiguous renders.
- **Messages** — Hybrid path: **REST `/api/inbox/messages`** where the native cookie jar allows, otherwise **MUI table / legacy DOM** scraping inside the authenticated WebView—tuned for oversized payloads and Cordova bridge limits.
- **Notes** — Parsed from the messaging SPA surfaces tied to Librus inbox notes flows.
- **Local persistence & diff** — `@capacitor/preferences` backed JSON blob; merges and flags **new** items per domain object type.
- **Android / iOS** — Capacitor-native wrappers; HTTPS enforcement and network security posture aligned with Librus redirects.

---

## Architecture & Technical Challenges

### Structure

| Layer | Role |
|-------|------|
| **Angular · standalone UI** (`HomePage`) | Tabs, Ionic components, modal detail views, segment navigation. |
| **`LibrusAuthService`** | Orchestrates **InAppBrowser**, login detection, ordered **multi-step sync**, SSO bridges, `loadstop` listeners, timeouts, safe teardown/close after sync. |
| **`LibrusScraperService`** | Large, versioned **`executeScript`** payloads: grades (including chunked JSON transport for bridge limits), messages, notes, announcements, calendar. |
| **`WiadomosciMessagesApiService`** | Optional **CapacitorHttp** inbox fetch using **`CapacitorCookies`** when cookies are visible to the native layer—orthogonal to HttpOnly cookie behavior in WebView. |
| **`LibrusStorageService`** | Single-document persistence, merge semantics, calendar enrichment on read, grade date backfill for older records. |
| **Pure utilities** | `grade-semester.ts`, `calendar-parse.ts` — testable extraction/parsing isolated from Ionic. |

There is **no global state library**: RxJS appears where Angular/Ionic idioms require it (e.g. browser events); authoritative state lives in **preferences-backed models** refreshed after each sync.

### Reverse engineering & integration (why this project is technically hard)

Librus does **not** ship a documented, tenant-agnostic public API suitable for third-party apps. Integration therefore required:

1. **Host & session topology** — Distinguishing **`synergia.librus.pl`** (dziennik surfaces) from **`wiadomosci.librus.pl`** (SPA inbox), **`portal.librus.pl`** (SSO hops), and understanding that **cookies are scoped per host** (e.g. `DZIENNIKSID` behavior across origins).
2. **SSO choreography** — Replaying **menu-driven navigation** (e.g. messages entry) so the browser receives the same **Set-Cookie** chain a human user would—direct deep links often yield **session-expired** SPA states.
3. **Undocumented JSON** — Observing **`/api/inbox/messages`** response shape (pagination, `messageId`, base64 `content`, read flags) and mapping it to internal **`Message`** models—while keeping payloads small enough for **Cordova `injectScript` return limits**.
4. **DOM fragility** — Multiple scrapers (MUI tables, legacy tables, grade `span.grade-box` graphs) with defensive selectors; **SPA paths** such as `/nowy` vs `/nowy/inbox` required **URL & `location.href` reconciliation** because `loadstop` events can lag the real document.
5. **Mobile bridge limits** — Avoiding **synchronous XHR loops** in one injection, chunking large grade JSON, and ordering **DOM-first** strategies for the inbox to prevent WebView/main-thread stalls.

This is classic **integration engineering**: constraints discovery, failure-mode analysis, and iterative hardening rather than “call a clean REST API.”

---

## AI-Assisted Development

This codebase was built with an explicit **AI-augmented workflow**:

- **Model:** **Claude 3.5 Sonnet** and **Claude 4.x-class** assistants (e.g. in Cursor) for rapid iteration.
- **Where AI added speed:** Ionic/Angular **boilerplate**, component scaffolding, template structure, SCSS layout passes, and repetitive service wiring—work that is valuable but **low leverage** for a principal-level narrative.
- **Where human judgment stayed in the loop:** **SSO graph**, **cookie jar semantics** (WebView vs. Capacitor), **scraper correctness** against live markup, **race conditions** on `loadstop`, **Android cleartext/HTTPS**, **payload size vs. bridge truncation**, and **data-model normalization**—the parts that dominate risk and differentiation.

Net effect: assistants compressed **delivery time** while the author concentrated **cognitive bandwidth** on the undocumented integration surface—matching how strong engineers use Copilot-class tools in enterprise settings.

---

## Tech Stack

- **Framework:** Angular 20, Ionic 8  
- **Language:** TypeScript 5.9  
- **Mobile runtime:** Capacitor 8 (Android & iOS)  
- **Native plugins:** `@capacitor/preferences`, `@capacitor/core` (**CapacitorHttp**, **CapacitorCookies**), Cordova **`cordova-plugin-inappbrowser`** (via `@awesome-cordova-plugins/in-app-browser`)  
- **UI:** Ionic components, Ionicons  
- **Tooling:** Angular CLI, ESLint, Karma / Jasmine  

For local setup and testing, see [`SETUP.md`](./SETUP.md) and [`TESTING_GUIDE.md`](./TESTING_GUIDE.md).

---

## Pre-built debug APK (GitHub Actions)

[![Build Android APK](https://github.com/talareq/librus-client/actions/workflows/build-android-apk.yml/badge.svg?branch=main)](https://github.com/talareq/librus-client/actions/workflows/build-android-apk.yml)
[![Release APK](https://github.com/talareq/librus-client/actions/workflows/release-apk.yml/badge.svg)](https://github.com/talareq/librus-client/actions/workflows/release-apk.yml)

### Stable download (`latest` release)

After at least one **tagged release** (see below), the newest **debug** APK is always at:

**[https://github.com/talareq/librus-client/releases/latest/download/librus-client.apk](https://github.com/talareq/librus-client/releases/latest/download/librus-client.apk)**

(If this returns 404, no release has been published yet.) All builds are **debug** APKs for local testing, not Play Store listings.

**Cut a release:** align `package.json` `version` with the tag (e.g. `0.2.0` → tag `v0.2.0`), commit to `main`, then:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The [`release-apk`](.github/workflows/release-apk.yml) workflow builds the app and attaches **`librus-client.apk`** to that GitHub Release. Publishing the release also triggers the post-release version bump on `main` (see [`.github/workflows/bump-version-after-release.yml`](.github/workflows/bump-version-after-release.yml)).

### CI artifacts (every push to `main`)

On each successful run, CI produces a **debug** `app-debug.apk` (installable for local testing; not a Play Store release build).

#### How to download from a workflow run

1. Open **[Build Android APK — workflow runs](https://github.com/talareq/librus-client/actions/workflows/build-android-apk.yml)** (all runs for this workflow on `main`).
2. Select the **latest run with a green checkmark** (e.g. [a successful run summary](https://github.com/talareq/librus-client/actions/runs/25622334922)).
3. On the run page, open the **Summary** tab.
4. In **Artifacts**, download the zip (name pattern `librus-client-<version>-<run>`).
5. Unzip the archive — the installable file is **`app-debug.apk`**.

You can also trigger a fresh build manually from the workflow page (**Run workflow**).

#### Notes on Actions artifacts

GitHub Actions **does not** offer a permalink that always points at a specific artifact across runs; each artifact belongs to one run and **expires** (currently **30 days** in [`build-android-apk.yml`](.github/workflows/build-android-apk.yml)). Prefer the **[latest release download](#stable-download-latest-release)** link above for a durable URL.

---

## Disclaimer

**This project is unofficial, non-affiliated, and not endorsed by Librus, Synergia, or any related vendor.**  
It exists **solely for educational and portfolio demonstration**—to exhibit software architecture, integration patterns, and problem decomposition. **It is not intended for commercial release, redistribution on app stores, or use as a production substitute for official Librus channels.** Names and trademarks belong to their respective owners. Users must comply with vendor terms of service and applicable law; accessing third-party systems with automation may violate those terms—**evaluate legality and ethics locally before running or extending this software.**

---

*Principal Product Engineer narrative: ship a coherent product-shaped artifact under ambiguous constraints, instrument the fragile boundary between web session and native shell, and document trade-offs clearly for technical leadership audiences.*
