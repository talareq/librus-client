import { Injectable } from '@angular/core';
import { Subscription, filter, firstValueFrom, take, timeout } from 'rxjs';
import { InAppBrowser, InAppBrowserObject, InAppBrowserEvent } from '@awesome-cordova-plugins/in-app-browser/ngx';
import { Capacitor, CapacitorCookies, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { LibrusScraperService } from './librus-scraper.service';
import { LibrusStorageService } from './librus-storage.service';
import { WiadomosciMessagesApiService } from './wiadomosci-messages-api.service';
import { SyncResult, SyncProgress, SyncAllOptions, Message } from '../models/librus-data.models';
import { environment } from '../../environments/environment';
import { devInfo, devLog, devWarn } from '../utils/dev-log';
import { notifyLocalSyncCompletedForTest } from '../utils/sync-local-notification';

interface CookieData {
  url: string;
  key: string;
  value: string;
  path?: string;
  expires?: string;
}

interface SessionData {
  cookies: CookieData[];
  timestamp: number;
  expiresAt?: number;
}

@Injectable({
  providedIn: 'root'
})
export class LibrusAuthService {
  private browser: InAppBrowserObject | null = null;
  /** Ponowne wstrzyknięcie rozmycia (React/SPA montuje inputy po pierwszym loadstop). */
  private demoIabBlurRetryHandles: ReturnType<typeof setTimeout>[] = [];
  /** Unikamy wielu handlerów loadstop (każdy miałby własny scrapingInProgress → nieskończona pętla injectScript). */
  private scrapeLoadStopSub: Subscription | null = null;
  /** Stare callbacki async po przejściu do kolejnej sekcji synchronizacji — ignorujemy. */
  private scrapeGeneration = 0;
  /** Pełny sync (`syncAllData`) — blokada równoległych wywołań (np. UI + zdalny FCM). */
  private syncAllDataInFlight = false;
  /** Cordova może wyemitować wiele loadstop na jednym fragmencie SPA — jedna sesja DOM scrapingu naraz. */
  private domScrapeRunning = false;
  /** Jednorazowo na cały `syncAllData`: schowanie IAB + sygnał dla UI, gdy zaczyna się pierwszy odczyt DOM po logowaniu. */
  private domScrapeUiGateDoneForSync = false;
  private pendingDomScrapeBeginCallback: (() => void) | undefined;

  /**
   * Chowamy InAppBrowser (inaczej preloader w WebView jest niewidoczny) i informujemy UI o starcie
   * faktycznego scrapowania — wywołanie tylko raz na całą synchronizację.
   */
  private domScrapeBeginGateOnce(): void {
    if (this.domScrapeUiGateDoneForSync) {
      return;
    }
    this.domScrapeUiGateDoneForSync = true;
    try {
      this.browser?.hide();
      devLog('👁️ InAppBrowser ukryty — w tle odczyt DOM; w aplikacji widać preloader.');
    } catch {
      /* noop */
    }
    try {
      this.pendingDomScrapeBeginCallback?.();
    } catch {
      /* noop */
    }
  }

  /** Czy ten adres w IAB wygląda jak logowanie / OAuth (włącza rozmycie pól). */
  private shouldDemoBlurWebViewUrl(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('loguj') ||
      u.includes('zaloguj') ||
      u.includes('/login') ||
      u.includes('rodzina/synergia') ||
      u.includes('konto.librus') ||
      u.includes('konto-librus') ||
      u.includes('/register') ||
      u.includes('session-expired') ||
      u.includes('accounts.google.') ||
      u.includes('/oauth') ||
      u.includes('openid')
    );
  }

  private clearDemoIabBlurRetries(): void {
    for (const h of this.demoIabBlurRetryHandles) {
      clearTimeout(h);
    }
    this.demoIabBlurRetryHandles = [];
  }

  /**
   * Kilka ponowień — jeden loadstop często jest zanim React/osadzone API pokaże inputy.
   */
  private armDemoIabBlurRetries(): void {
    this.clearDemoIabBlurRetries();
    if (!environment.demoRecordingPrivacy || !this.browser) {
      return;
    }
    const inject = (): void => {
      if (!environment.demoRecordingPrivacy || !this.browser) {
        return;
      }
      const code = this.demoRecordingBlurInstallInWebView();
      void this.browser.executeScript({ code });
    };
    for (const ms of [0, 100, 350, 900, 2000, 4500, 8000]) {
      this.demoIabBlurRetryHandles.push(setTimeout(inject, ms));
    }
  }

  /**
   * Rozmycie + maskowanie znaków w polach formularza na stronach logowania (także Shadow DOM / SPA).
   * Wymaga `environment.demoRecordingPrivacy` (np. build: `npm run build:demo`).
   */
  private syncDemoRecordingBlurForWebView(url: string): void {
    if (!environment.demoRecordingPrivacy || !this.browser || !url) {
      return;
    }
    const blurInputs = this.shouldDemoBlurWebViewUrl(url);
    if (!blurInputs) {
      this.clearDemoIabBlurRetries();
      void this.browser.executeScript({ code: this.demoRecordingBlurRemoveFromWebView() });
      return;
    }
    devInfo('[demo-privacy] Rozmycie pól logowania w InAppBrowser — jeśli nadal widać tekst, zbuduj app: npm run build:demo && npx cap sync android');
    void this.browser.executeScript({ code: this.demoRecordingBlurInstallInWebView() });
    this.armDemoIabBlurRetries();
  }

  /**
   * Jedna linia — niektóre WebView gorzej radzą sobie z wieloliniowym `evaluateJavascript`.
   * Style także w otwartym Shadow DOM; [role=textbox] dla widżetów typu ARIA.
   */
  private demoRecordingBlurInstallInWebView(): string {
    return "(function(){try{var STYLE_ID='librus-demo-login-blur-style';var CSS='input:not([type=hidden]),textarea,select,[contenteditable=\\\"true\\\"],[contenteditable=\\\"\\\"],[contenteditable],[role=textbox]{-webkit-text-security:disc!important;filter:blur(18px)!important;-webkit-filter:blur(18px)!important;letter-spacing:0.6em!important;color:transparent!important;text-shadow:0 0 12px rgba(0,0,0,0.85)!important;}';function ensureMain(){var e=document.getElementById(STYLE_ID);if(!e){e=document.createElement('style');e.id=STYLE_ID;(document.head||document.documentElement).appendChild(e);}e.textContent=CSS;}function injectShadow(r){if(!r||!r.appendChild)return;try{if(r.querySelector&&r.querySelector('#'+STYLE_ID))return;var s=document.createElement('style');s.id=STYLE_ID;s.textContent=CSS;r.appendChild(s);}catch(_){}}function walk(n){if(!n)return;if(n.shadowRoot)injectShadow(n.shadowRoot);var ch=n.children||[];for(var i=0;i<ch.length;i++)walk(ch[i]);}function boot(){ensureMain();if(document.body)walk(document.body);}boot();if(!window.__librusDemoBlurObserver){window.__librusDemoBlurObserver=new MutationObserver(function(){boot();});window.__librusDemoBlurObserver.observe(document.documentElement,{childList:true,subtree:true});}}catch(_){}})();";
  }

  private demoRecordingBlurRemoveFromWebView(): string {
    return "(function(){try{var mo=window.__librusDemoBlurObserver;if(mo&&mo.disconnect)mo.disconnect();delete window.__librusDemoBlurObserver;var e=document.getElementById('librus-demo-login-blur-style');if(e)e.remove();}catch(_){}})();";
  }

  private readonly COOKIE_STORAGE_KEY = 'librus_session_cookies';
  /** Czas ważności markera w Preferencjach (nie równa się TTL cookies HttpOnly w WebView). */
  private readonly SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 dni
  private readonly LIBR_SYNERGIA_COOKIE_URL = 'https://synergia.librus.pl';
  /** Dashboard rodzica (GET testowy po Sync — `runDeferredHttpPingAfterSync`). */
  private readonly LIBR_SYNERGIA_RODZIC_DASHBOARD_URL =
    'https://synergia.librus.pl/rodzic/index';
  private readonly LIBR_WIADOMOSCI_COOKIE_URL = 'https://wiadomosci.librus.pl';
  /**
   * Kolejność jak w Chrome (Application → Cookies → synergia) przy żądaniu do rodzic/index.
   */
  private readonly rodzicCookieHeaderKeyOrder = [
    'TestCookie',
    'access_denied_login_url',
    'cookiesession1',
    'SDZIENNIKSID',
    'DZIENNIKSID',
    'oauth_token',
  ] as const;
  /** Domyślna wartość `access_denied_login_url` gdy brak w słoiku (jak typowy link logowania). */
  private readonly rodzicDefaultAccessDeniedLoginUrl =
    'https%3A%2F%2Fsynergia.librus.pl%2Floguj';
  /** Domeny do zapisu / diagnozy — ten sam zestaw co w `saveCookies`. */
  private readonly capacitorJarOrigins = [
    'https://synergia.librus.pl',
    'https://wiadomosci.librus.pl',
    'https://portal.librus.pl',
    'https://api.librus.pl'
  ] as const;

  /**
   * Kolejność łączenia słoików przy nagłówku dla rodzic/index — **synergia na końcu**,
   * żeby `DZIENNIKSID` / `cookiesession1` z Synergii nie były nadpisywane inną domeną.
   */
  private readonly rodzicCookieJarMergeOrder = [
    'https://api.librus.pl',
    'https://portal.librus.pl',
    'https://wiadomosci.librus.pl',
    'https://synergia.librus.pl',
  ] as const;

  /**
   * TYMCZASOWY TEST: przy Sync tylko wykrycie udanego logowania (loadstop),
   * potem przejście na skrzynkę wiadomości — bez parsowania, bez chowania IAB.
   * Ustaw na `true` tylko do ręcznych testów mostka (inaczej Sync omija scraping).
   */
  private readonly TEST_SYNC_LOGIN_ONLY_NAV_WIADOMOSCI = false;

  constructor(
    private iab: InAppBrowser,
    private scraperService: LibrusScraperService,
    private storageService: LibrusStorageService,
    private wiadomosciMsgsApi: WiadomosciMessagesApiService
  ) {
    devLog('🚀 LibrusAuthService: Inicjalizacja...');
  }

  async restoreSavedCookies(): Promise<boolean> {
    try {
      const { value } = await Preferences.get({ key: this.COOKIE_STORAGE_KEY });
      
      if (!value) {
        devLog('Brak zapisanych cookies.');
        return false;
      }

      const sessionData: SessionData = JSON.parse(value);
      
      if (sessionData.expiresAt && Date.now() > sessionData.expiresAt) {
        devLog('Sesja wygasła, usuwam stare cookies.');
        await this.clearSession();
        return false;
      }

      devLog(`Przywracam ${sessionData.cookies.length} zapisanych cookies...`);
      
      for (const cookie of sessionData.cookies) {
        await CapacitorCookies.setCookie({
          url: cookie.url || 'https://synergia.librus.pl',
          key: cookie.key,
          value: cookie.value,
          path: cookie.path || '/',
          expires: cookie.expires
        });
      }

      devLog('Cookies przywrócone pomyślnie!');
      return true;
    } catch (error) {
      console.error('Błąd przywracania cookies:', error);
      return false;
    }
  }

  async injectCookiesIntoBrowser(): Promise<void> {
    if (!this.browser) {
      return;
    }

    try {
      const { value } = await Preferences.get({ key: this.COOKIE_STORAGE_KEY });
      
      if (!value) {
        devLog('⚠️ Brak cookies do wstrzyknięcia.');
        return;
      }

      const sessionData: SessionData = JSON.parse(value);
      
      if (sessionData.expiresAt && Date.now() > sessionData.expiresAt) {
        devLog('⚠️ Sesja wygasła.');
        return;
      }

      devLog(`💉 Wstrzykuję ${sessionData.cookies.length} cookies...`);

      // Tworzymy skrypt który wstrzyknie każdy cookie osobno (nazwa/wartość escapowane — unikamy przełamania literału JS)
      const cookieScripts = sessionData.cookies
        .map(c => {
          const expires = new Date();
          expires.setFullYear(expires.getFullYear() + 1);
          const k = this.escapeJsSingleQuoted(c.key);
          const v = this.escapeJsSingleQuoted(c.value);
          const exp = this.escapeJsSingleQuoted(expires.toUTCString());
          return `document.cookie = '${k}=${v}; path=/; domain=.librus.pl; expires=${exp}';`;
        })
        .join('\n');

      const injectScript = `
        (function() {
          ${cookieScripts}
          return document.cookie;
        })();
      `;

      const result = await this.browser.executeScript({ code: injectScript });
      devLog('✅ Cookies wstrzyknięte do przeglądarki. Wynik:', result);
    } catch (error) {
      console.error('❌ Błąd wstrzykiwania cookies:', error);
    }
  }

  async extractAndSaveCookiesFromBrowser(): Promise<void> {
    if (!this.browser) {
      return;
    }

    try {
      const cookieScript = `
        (function() {
          return document.cookie;
        })();
      `;

      const result = await this.browser.executeScript({ code: cookieScript });
      const cookieString = result && result[0] ? result[0] : '';

      if (!cookieString) {
        devLog('⚠️ Brak cookies do wyodrębnienia z przeglądarki.');
        return;
      }

      devLog('📦 Wyodrębnione cookies:', cookieString);

      const cookiePairs = cookieString.split(';').map((c: string) => c.trim());
      const cookies: CookieData[] = [];

      for (const pair of cookiePairs) {
        const eq = pair.indexOf('=');
        if (eq <= 0) {
          continue;
        }
        const key = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (key && value) {
          cookies.push({
            url: 'https://synergia.librus.pl',
            key,
            value,
            path: '/'
          });

          // Zapisujemy też do CapacitorCookies jako backup
          await CapacitorCookies.setCookie({
            url: 'https://synergia.librus.pl',
            key,
            value,
            path: '/'
          });
        }
      }

      if (cookies.length > 0) {
        const sessionData: SessionData = {
          cookies: cookies,
          timestamp: Date.now(),
          expiresAt: Date.now() + this.SESSION_DURATION
        };

        await Preferences.set({
          key: this.COOKIE_STORAGE_KEY,
          value: JSON.stringify(sessionData)
        });

        devLog(`✅ Zapisano ${cookies.length} cookies do Preferences.`);
        devLog('📋 Lista cookies:', cookies.map(c => c.key).join(', '));
      }
    } catch (error) {
      console.error('❌ Błąd wyodrębniania cookies z przeglądarki:', error);
    }
  }

  async saveCookies(): Promise<void> {
    try {
      const allCookies: CookieData[] = [];

      for (const domain of this.capacitorJarOrigins) {
        try {
          const cookies = await CapacitorCookies.getCookies({ url: domain });
          
          Object.entries(cookies).forEach(([key, value]) => {
            allCookies.push({
              url: domain,
              key: key,
              value: value,
              path: '/'
            });
          });
        } catch (err) {
          devWarn(`Nie można pobrać cookies z ${domain}:`, err);
        }
      }

      if (allCookies.length === 0) {
        devLog('Brak cookies do zapisania.');
        return;
      }

      const sessionData: SessionData = {
        cookies: allCookies,
        timestamp: Date.now(),
        expiresAt: Date.now() + this.SESSION_DURATION
      };

      await Preferences.set({
        key: this.COOKIE_STORAGE_KEY,
        value: JSON.stringify(sessionData)
      });

      devLog(`Zapisano ${allCookies.length} cookies.`);
    } catch (error) {
      console.error('Błąd zapisywania cookies:', error);
    }
  }

  async clearSession(): Promise<void> {
    try {
      devLog('🧹 Czyszczenie markera sesji...');
      await Preferences.remove({ key: this.COOKIE_STORAGE_KEY });
      
      // NIE zamykamy przeglądarki, tylko czyścimy marker
      // Przeglądarka zostanie zamknięta przez użytkownika lub przy wylogowaniu
      
      devLog('✅ Marker sesji wyczyszczony.');
    } catch (error) {
      console.error('❌ Błąd czyszczenia sesji:', error);
    }
  }

  async forceLogout(): Promise<void> {
    try {
      devLog('🚪 Wymuszam pełne wylogowanie...');
      
      // Czyścimy marker
      await this.clearSession();
      
      // Zamykamy przeglądarkę aby wymusić nowe logowanie
      if (this.browser) {
        this.browser.close();
        this.clearDemoIabBlurRetries();
        this.browser = null;
        devLog('✅ Przeglądarka zamknięta - sesja całkowicie wyczyszczona.');
      }
    } catch (error) {
      console.error('❌ Błąd wylogowania:', error);
    }
  }

  /**
   * Zrzut ciastek do konsoli (CapacitorCookies per domenę + treść widoczna w `document.cookie` w IAB).
   * Wartości mogą obejmować identyfikatory sesji — używaj tylko przy lokalnym debugowaniu.
   */
  async dumpCookiesToConsole(reason = 'debug'): Promise<void> {
    devLog(`\n🍪 ---------- zrzut cookies (${reason}) ----------`);
    for (const origin of this.capacitorJarOrigins) {
      try {
        const jar = await CapacitorCookies.getCookies({ url: origin });
        const rec = jar as Record<string, string>;
        const keys = Object.keys(rec || {});
        const header =
          keys.length > 0 ? this.jarToCookieHeader(rec).trim() : '';
        devLog(`🍪 CapacitorCookies [${origin}]`);
        devLog(
          `   liczba: ${keys.length}${keys.length ? ` → ${keys.join(', ')}` : ' (brak lub niedostępne na tej platformie)'}`
        );
        devLog('   jako obiekt:', rec);
        if (header.length > 0) {
          devLog(`   nagłówek Cookie (${header.length} znaków):`, header);
        }
      } catch (e) {
        devWarn(`🍪 CapacitorCookies [${origin}] błąd:`, e);
      }
    }
    if (this.browser) {
      try {
        const raw = await this.browser.executeScript({
          code:
            "(function(){ try { return JSON.stringify(String(document.cookie || '')); } catch(e){ return '\"\"'; } })();"
        });
        const txt = this.parseBridgeScriptResult(raw?.[0]);
        const dc = typeof txt === 'string' ? txt : '';
        devLog(
          '🍪 IAB WebView document.cookie:',
          dc.length ? dc : '(pusto lub niedostępne)'
        );
        devLog(
          '   (HttpOnly nie widać w document.cookie — tylko w natywnym słoiku / sieci)'
        );
      } catch (e) {
        devWarn('🍪 IAB document.cookie — błąd:', e);
      }
    } else {
      devLog('🍪 IAB WebView — brak aktywnej instancji (document.cookie pominięty)');
    }
    devLog(`🍪 ---------- koniec zrzutu (${reason}) ----------\n`);
  }

  /** Podczas Sync: same nazwy kluczy w natywnym słoiku (bez wartości). */
  private async logCapacitorCookieJarKeysBrief(context: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      devLog(
        `🍪 ${context} — CapacitorCookies: (pominięto — nie urządzenie natywne)`
      );
      return;
    }
    try {
      const summary: Record<string, string[]> = {};
      for (const origin of this.capacitorJarOrigins) {
        const jar = await CapacitorCookies.getCookies({ url: origin });
        const keys = Object.keys(jar || {}).sort();
        let host: string = origin;
        try {
          host = new URL(origin).hostname;
        } catch {
          /* noop */
        }
        summary[host] = keys;
      }
      devLog(`🍪 ${context} — klucze CapacitorCookies`, summary);
      const w = summary['wiadomosci.librus.pl'];
      devLog(
        `   → wiadomosci.librus.pl: ${w?.length ?? 0} wpisów` +
          (w?.length ? ` (${w.join(', ')})` : ' — REST skrzynki wymaga tego słoika')
      );
    } catch (e) {
      devWarn(`🍪 ${context} — odczyt słoika:`, e);
    }
  }

  async debugSavedCookies(): Promise<any> {
    try {
      const { value } = await Preferences.get({ key: this.COOKIE_STORAGE_KEY });
      
      if (!value) {
        devLog('❌ Brak zapisanego markera sesji');
        await this.dumpCookiesToConsole('Sesja/app — marker brak 🐛');
        return { exists: false };
      }

      const sessionData = JSON.parse(value);
      const now = Date.now();
      const isExpired = sessionData.expiresAt ? now > sessionData.expiresAt : false;
      const browserExists = this.browser !== null;
      
      devLog('=== SESSION DEBUG ===');
      devLog('Marker aktywny:', sessionData.active);
      devLog('Przeglądarka istnieje:', browserExists);
      devLog('Timestamp:', new Date(sessionData.timestamp).toLocaleString());
      devLog('Wygasa:', sessionData.expiresAt ? new Date(sessionData.expiresAt).toLocaleString() : 'brak');
      devLog('Czy wygasło?', isExpired);
      const savedCookieRows = Array.isArray(sessionData.cookies)
        ? (sessionData.cookies as CookieData[])
        : null;
      if (savedCookieRows && savedCookieRows.length > 0) {
        devLog(
          `🍪 Snapshot w Preferences (${savedCookieRows.length} wpisów z saveCookies):`,
          savedCookieRows
        );
      } else {
        devLog(
          '🍪 W Preferences pod tym kluczem brak tablicy `cookies` (np. sam marker po markSessionActive).'
        );
      }

      await this.dumpCookiesToConsole('Sesja/app — przycisk debug 🐛');
      
      return {
        exists: true,
        active: sessionData.active,
        browserExists: browserExists,
        timestamp: sessionData.timestamp,
        expiresAt: sessionData.expiresAt,
        isExpired: isExpired
      };
    } catch (error) {
      console.error('❌ Błąd debugowania sesji:', error);
      return { error: error };
    }
  }

  async checkSessionValid(): Promise<boolean> {
    try {
      const { value } = await Preferences.get({ key: this.COOKIE_STORAGE_KEY });
      
      if (!value) {
        devLog('❌ Brak zapisanego markera sesji.');
        return false;
      }

      const sessionData = JSON.parse(value);
      
      // Sprawdzamy czy sesja jest aktywna I czy przeglądarka nadal istnieje
      const isActive = sessionData.active === true;
      const notExpired = !sessionData.expiresAt || Date.now() <= sessionData.expiresAt;
      const browserExists = this.browser !== null;

      devLog('📊 Status sesji:', {
        isActive,
        notExpired,
        browserExists,
        savedAt: sessionData.timestamp ? new Date(sessionData.timestamp).toLocaleTimeString() : 'unknown'
      });

      if (!notExpired) {
        devLog('⏰ Sesja wygasła lokalnie (timeout).');
        await this.clearSession();
        return false;
      }

      // Sesja w sensie aplikacji: marker + nie przeterminowany lokalnie.
      // WebView może być null po restarcie — Sync tworzy IAB ponownie; osobny magazyn cookies na iOS/Android
      // często i tak trzyma sesję Librusa, więc nie wymuszamy „wylogowania” wyłącznie przez brak instancji.
      const isValid = isActive && notExpired;

      if (isValid && !browserExists) {
        devLog(
          'ℹ️ Marker sesji aktywny — instancja IAB zamknięta; kolejny Sync otworzy ukryty WebView lub poprosi o logowanie.'
        );
      }

      return isValid;
    } catch (error) {
      console.error('❌ Błąd sprawdzania sesji:', error);
      return false;
    }
  }

  /**
   * Pobiera JSON ocen przez małe kawalki (`window.__LIBR_GR`): ten sam DOM co stary kod (`span.grade-box a`),
   * bez pojedynczego gigantycznego zwrotu z `executeScript`.
   */
  private async readGradesJsonChunkedFromBrowser(
    onChunk?: (index: number, total: number) => void
  ): Promise<any[] | null> {
    const bootstrap = await this.browser?.executeScript({
      code: this.scraperService.getGradesChunkBootstrapScript()
    });
    const meta = this.parseBridgeScriptResult(bootstrap?.[0]) as Record<string, unknown> | null;

    if (!meta || meta['ok'] !== true || typeof meta['parts'] !== 'number') {
      devWarn(
        '⚠️ Oceny (chunk bootstrap) — meta:',
        JSON.stringify(meta)
      );
      return null;
    }

    const parts = meta['parts'] as number;
    if (!Number.isFinite(parts) || parts < 0 || parts > 20000) {
      devWarn('⚠️ Oceny — nieprawidłowa liczba części:', parts);
      return null;
    }
    devLog(`📚 Oceny — transport w częściach: ${parts} segmentów, ~${meta['len']} bajtów JSON`);

    let buf = '';
    for (let i = 0; i < parts; i++) {
      onChunk?.(i, parts);
      const chunk = await this.browser?.executeScript({
        code: `(function(){ try { var w = window.__LIBR_GR || []; var s = w[${i}]; return JSON.stringify(typeof s === 'string' ? s : ''); } catch (e) { return JSON.stringify(''); } })();`
      });
      const piece = this.parseBridgeScriptResult(chunk?.[0]);
      buf += typeof piece === 'string' ? piece : '';
    }

    try {
      this.browser?.executeScript({
        code: 'try { delete window.__LIBR_GR; } catch (e) {}'
      });
    } catch {
      /* noop */
    }

    try {
      const arr = JSON.parse(buf);
      return Array.isArray(arr) ? arr : null;
    } catch (e) {
      console.error('❌ Oceny — błąd JSON po złożeniu części:', e);
      return null;
    }
  }

  /** Odczytuje wartość z `executeScript` (Cordova często zwraca JSON jako string). */
  private parseBridgeScriptResult(first: unknown): unknown {
    if (first === undefined || first === null) {
      return null;
    }
    if (typeof first === 'string') {
      const s = first.trim();
      if (!s) {
        return null;
      }
      try {
        return JSON.parse(s);
      } catch (e) {
        devWarn('⚠️ parseBridgeScriptResult: niepoprawny JSON z WebView:', s.slice(0, 280));
        return null;
      }
    }
    return first;
  }

  /** Wygaśnięcie SSO na skrzynce bywa tylko w treści strony (URL bez /session-expired). */
  private isWiadomosciSessionExpiredInPage(
    sectionUrl: string,
    diagnostics: Record<string, unknown> | null
  ): boolean {
    try {
      if (!diagnostics || !sectionUrl.includes('wiadomosci.librus.pl')) {
        return false;
      }
      const sample = String(diagnostics['sampleText'] ?? '').toLowerCase();
      const title = String(diagnostics['title'] ?? '').toLowerCase();
      const haystack = `${sample} ${title}`;
      if (
        haystack.includes('sesja wygasła') ||
        haystack.includes('sesji wygasła') ||
        haystack.includes('sesja wygasla') ||
        haystack.includes('sesji wygasla')
      ) {
        return true;
      }
      if (
        haystack.includes('zaloguj się ponownie') ||
        haystack.includes('zaloguj sie ponownie')
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Skrzynka `/nowy/inbox` i uwagi `/nowy/inbox-notes` — bez wymuszania logowania w IAB
   * przy session-expired / portalu (reszta Sync może działać na Synergii).
   */
  private isWiadomosciMailboxSectionWithoutForcedRelog(sectionUrl: string): boolean {
    try {
      const u = new URL(sectionUrl);
      if (!u.hostname.includes('wiadomosci.librus.pl')) {
        return false;
      }
      const p = u.pathname.replace(/\/+$/, '') || '/';
      return p === '/nowy/inbox' || p === '/nowy/inbox-notes';
    } catch {
      return false;
    }
  }

  private tearDownScrapeLoadStop(): void {
    if (this.scrapeLoadStopSub) {
      try {
        this.scrapeLoadStopSub.unsubscribe();
      } catch {
        /* noop */
      }
      this.scrapeLoadStopSub = null;
    }
  }

  /**
   * Po pełnym syncu trzeba zdjąć IAB z ekranu. Samo `hide()` na Androidzie bywa bez skutku
   * po `wiadomosci.librus.pl` (SPA/CCT) — `close()` usuwa widok niezawodnie.
   */
  private closeInAppBrowserAfterSync(reason: string): void {
    this.tearDownScrapeLoadStop();
    const b = this.browser;
    if (!b) {
      return;
    }
    try {
      b.hide();
    } catch {
      /* noop */
    }
    try {
      b.close();
    } catch {
      /* noop */
    }
    this.clearDemoIabBlurRetries();
    this.browser = null;
  }

  /** Docelowy URL jest na innym hoście niż portal — SSO często pokazuje portal pośredni; nie wylogowujemy. */
  private targetUsesPortalSsoHop(sectionUrl: string): boolean {
    try {
      const h = new URL(sectionUrl).hostname;
      return h.includes('wiadomosci.librus.pl') || h.includes('synergia.librus.pl');
    } catch {
      return false;
    }
  }

  /**
   * Pierwszy skok na wiadomościowy SPA lepiej robić na `/nowy/`, żeby serwer przykleił
   * osobną sesję tej aplikacji; bezpośrednie `/nowy/inbox` po logowaniu na Synergii
   * często kończy się `/nowy/session-expired`.
   */
  private getWiadomosciWarmStartUrl(sectionUrl: string): string {
    try {
      const fixed = this.ensureHttpsLibrusUrl(sectionUrl);
      const u = new URL(fixed);
      if (!u.hostname.includes('wiadomosci.librus.pl')) {
        return fixed;
      }
      const base = 'https://wiadomosci.librus.pl';
      const pathname = u.pathname.replace(/\/+$/, '') || '/';
      if (pathname === '' || pathname === '/') {
        return `${base}/nowy/`;
      }
      if (pathname.startsWith('/nowy')) {
        return `${base}/nowy/`;
      }
      return fixed;
    } catch {
      return this.ensureHttpsLibrusUrl(sectionUrl);
    }
  }

  /** Czy jesteśmy na wejściu SPA `/nowy` przed konkretnym widokiem (inbox / uwagi)? */
  private isWiadomosciSpaWarmupPage(loadedUrl: string, sectionUrl: string): boolean {
    try {
      const want = new URL(sectionUrl);
      if (!want.hostname.includes('wiadomosci.librus.pl')) {
        return false;
      }
      const wantPath =
        (want.pathname || '/').replace(/\/+$/, '') || '/';
      if (wantPath.toLowerCase().includes('inbox-notes')) {
        /** Na /nowy bez jawnego inbox-notes skrypt uwag się myli — nie traktować jak gotowej strony. */
        return false;
      }
      const got = new URL(loadedUrl);
      if (want.hostname !== got.hostname) {
        return false;
      }
      const norm = (path: string) => {
        const x = path.replace(/\/+$/, '');
        return x === '' ? '/' : x;
      };
      const pn = norm(got.pathname || '/');
      return pn === '/nowy';
    } catch {
      return false;
    }
  }

  /** Aktualny href z WebView (SPA może różnić się od event.url przy loadstop). */
  private async readWebViewLocationHref(fallbackUrl: string): Promise<string> {
    try {
      const raw = await this.browser?.executeScript({
        code: `(function(){ try { return JSON.stringify(String(location.href || '')); } catch (_) { return '""'; } })()`
      });
      const parsed = this.parseBridgeScriptResult(raw?.[0]);
      if (
        typeof parsed === 'string' &&
        parsed.startsWith('http')
      ) {
        return this.ensureHttpsLibrusUrl(parsed);
      }
    } catch {
      /* noop */
    }
    return fallbackUrl;
  }

  /** Porównanie host + pathname — unikamy błędu `/nowy/inbox` ⊂ `/nowy/inbox-notes`. */
  private urlMatchesSectionPage(loadedUrl: string, sectionUrl: string): boolean {
    try {
      const want = new URL(sectionUrl);
      const got = new URL(loadedUrl);
      const norm = (p: string) => {
        const x = p || '/';
        return x.replace(/\/+$/, '') || '/';
      };
      return want.hostname === got.hostname && norm(want.pathname) === norm(got.pathname);
    } catch {
      return false;
    }
  }

  /**
   * Skrzynka na `wiadomosci.librus.pl`: dokument bywa pod `/nowy` lub `/nowy/` mimo widoku inbox/uwagi
   * (routing po hash / wewnętrznie). Bez tego sync nigdy nie wpada w scraping i zapętla most SSO.
   */
  private wiadomosciSpaPathCoversSection(loadedUrl: string, sectionUrl: string): boolean {
    try {
      const want = new URL(this.ensureHttpsLibrusUrl(sectionUrl));
      const got = new URL(this.ensureHttpsLibrusUrl(loadedUrl));
      if (
        !want.hostname.includes('wiadomosci.librus.pl') ||
        want.hostname !== got.hostname
      ) {
        return false;
      }
      const norm = (p: string) => ((p || '/').replace(/\/+$/, '') || '/').toLowerCase();
      const wn = norm(want.pathname);
      const gn = norm(got.pathname);
      const hash = (got.hash || '').toLowerCase();

      if (wn.includes('inbox-notes')) {
        if (gn.includes('inbox-notes')) {
          return true;
        }
        return (
          hash.includes('note') ||
          hash.includes('uwag') ||
          hash.includes('inbox-note')
        );
      }

      if (wn.endsWith('/inbox')) {
        if (gn.endsWith('/inbox') || gn.includes('/inbox/')) {
          return true;
        }
        if (gn === '/nowy') {
          return (
            !hash.includes('note') &&
            !hash.includes('uwag') &&
            !hash.includes('inbox-note')
          );
        }
        return false;
      }

      return false;
    } catch {
      return false;
    }
  }

  /** Czy adres z WebView odpowiada docelowej sekcji (w tym uproszczony path SPA Librusa dla wiadomości). */
  private scrapeTargetPageReady(loadedUrl: string, sectionUrl: string): boolean {
    if (this.urlMatchesSectionPage(loadedUrl, sectionUrl)) {
      return true;
    }
    try {
      if (new URL(sectionUrl).hostname.includes('wiadomosci.librus.pl')) {
        return this.wiadomosciSpaPathCoversSection(loadedUrl, sectionUrl);
      }
    } catch {
      /* noop */
    }
    return false;
  }

  /**
   * String w literale `'…'` przekazywanym do `executeScript` — bez znaków końca linii (składnia JS),
   * escapowane `\` oraz `'`.
   */
  private escapeJsSingleQuoted(value: string): string {
    return String(value)
      .replace(/[\r\n\u2028\u2029]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }

  /**
   * Android 9+ blokuje `http://` w WebView (`ERR_CLEARTEXT_NOT_PERMITTED`).
   * Serwer Librusa lub `location.href` po złym redirectcie bywa na http — zawsze podnieś na https.
   */
  private ensureHttpsLibrusUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:') {
        return url;
      }
      const h = u.hostname.toLowerCase();
      if (
        h === 'wiadomosci.librus.pl' ||
        h === 'synergia.librus.pl' ||
        h === 'portal.librus.pl' ||
        h === 'api.librus.pl' ||
        h.endsWith('.librus.pl')
      ) {
        u.protocol = 'https:';
        return u.toString();
      }
    } catch {
      /* noop */
    }
    return url;
  }

  /**
   * Librus: `DZIENNIKSID` ustawione dla hosta `synergia.librus.pl` nie jest wysyłane na `wiadomosci.librus.pl`
   * (inny host). Bez łańcucha jak z UI (menu „Wiadomości” → przekierowanie / Set-Cookie dla skrzynki)
   * SPA kończy na `/nowy/session-expired`. To nie jest błąd kolejki loadstop — to brak osobnej sesji skrzynki.
   */
  private async waitUntilIabHref(
    predicate: (h: string) => boolean,
    timeoutMs: number,
    stepMs: number,
    progressLabel?: string,
    opts?: {
      /** Zbyt wiele z rzędu → przerwij (unikamy 28 s pętli przy ustabilizowanym session-expired / loguj). */
      earlyFailIf?: (h: string) => boolean;
      earlyFailAfterSteps?: number;
      earlyFailLog?: string;
    }
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastProgressLog = 0;
    const progressEveryMs = 2800;
    let badStreak = 0;
    const needBad = Math.max(1, opts?.earlyFailAfterSteps ?? 4);

    while (Date.now() < deadline) {
      await new Promise<void>(r => setTimeout(r, stepMs));
      const h = await this.readWebViewLocationHref('');
      if (predicate(h)) {
        if (progressLabel) {
          devLog(`🔗 ${progressLabel}: OK`, h.length > 140 ? h.slice(0, 140) + '…' : h);
        }
        return true;
      }
      if (opts?.earlyFailIf?.(h)) {
        badStreak += 1;
        if (badStreak >= needBad) {
          devWarn(
            `🔗 ${progressLabel}: wczesne zakończenie (${badStreak}×) — ${opts.earlyFailLog ?? 'earlyFailIf'}`,
            h ? h.slice(0, 160) : '(brak)'
          );
          return false;
        }
      } else {
        badStreak = 0;
      }
      if (
        progressLabel &&
        Date.now() - lastProgressLog >= progressEveryMs
      ) {
        lastProgressLog = Date.now();
        devLog(
          `🔗 ${progressLabel}: czekam (${stepMs} ms / próba href)…`,
          h ? (h.length > 130 ? h.slice(0, 130) + '…' : h) : '(brak)'
        );
      }
    }
    if (progressLabel) {
      const tail = await this.readWebViewLocationHref('');
      devWarn(
        `🔗 ${progressLabel}: koniec czasu (${timeoutMs} ms), ostatni href:`,
        tail ? tail.slice(0, 180) : '(brak)'
      );
    }
    return false;
  }

  private async openWiadomosciViaSynergiaSsoBridge(finalUrl: string): Promise<void> {
    if (!finalUrl.includes('wiadomosci.librus.pl')) {
      return;
    }
    const b = this.browser;
    if (!b) {
      return;
    }

    const warm = this.getWiadomosciWarmStartUrl(finalUrl);
    const finalUrlHttps = this.ensureHttpsLibrusUrl(finalUrl);
    const finalEsc = this.escapeJsSingleQuoted(finalUrlHttps);
    const warmEsc = this.escapeJsSingleQuoted(warm);

    try {
      const rawCur = await this.readWebViewLocationHref('');
      const cur = this.ensureHttpsLibrusUrl(rawCur || '');
      const low = cur.toLowerCase();
      if (
        low.includes('wiadomosci.librus.pl') &&
        !low.includes('/session-expired') &&
        low.indexOf('/loguj') < 0
      ) {
        const target = this.ensureHttpsLibrusUrl(finalUrlHttps);
        let curU: URL | null = null;
        let tgtU: URL | null = null;
        try {
          curU = new URL(cur);
          tgtU = new URL(target);
        } catch {
          curU = null;
          tgtU = null;
        }
        if (curU && tgtU && curU.hostname === tgtU.hostname) {
          const normPath = (p: string) => {
            const x = (p || '/').replace(/\/+$/, '');
            return x === '' ? '/' : x;
          };
          if (normPath(curU.pathname) !== normPath(tgtU.pathname)) {
            devLog(
              '🔗 Skrzynka: już na wiadomosci — tylko zmiana ścieżki (bez ponownego mostka Synergia):',
              target.slice(0, 96)
            );
            await b.executeScript({
              code: `(function(){
                try {
                  var target = '${finalEsc}';
                  var cur = String(location.href||'');
                  var path = '';
                  try { path = new URL(target).pathname.replace(/\\/+$/, '') || '/'; } catch(e) {}
                  if (path && cur.split('#')[0].indexOf(path) < 0) {
                    window.location.href = target;
                  }
                } catch(e2) {}
              })();`,
            });
          } else {
            devLog('🔗 Skrzynka: już na docelowej ścieżce wiadomosci — pomijam mostek.');
          }
          await new Promise<void>(r => setTimeout(r, 500));
          return;
        }
      }
    } catch {
      /* pełny mostek Synergia → Wiadomości */
    }

    devLog(
      '🔗 Skrzynka: wejście jak w przeglądarce (Synergia → link Wiadomości); sam URL wiadomosci bez SSO zwykle daje session-expired.'
    );

    /**
     * Kolejne wejścia na Synergię przed przejściem do Wiadomości (cookies / SSO).
     * Nie używać `/rodzica` — na serwerze często 404 (`Not Found`).
     */
    const synEntries = [
      'https://synergia.librus.pl/',
      'https://synergia.librus.pl/przegladaj_oceny/uczen',
      'https://portal.librus.pl/rodzina/synergia',
    ];

    const wdPredicate = (h: string): boolean =>
      h.includes('wiadomosci.librus.pl') &&
      !h.includes('/session-expired') &&
      !h.toLowerCase().includes('/loguj');

    const postLoginSurface = (h: string): boolean => {
      if (this.synergiaWebViewReadyForWiadomosciMenuClick(h)) {
        return true;
      }
      /** Portal po SSO: nie traktuj samego /rodzina ani /rodzina/ jako gotowej sesji (mostek na wiadomości za wcześnie). */
      try {
        const eu = new URL(h);
        const pl = eu.pathname.toLowerCase();
        if (!eu.hostname.includes('portal.librus.pl')) {
          return false;
        }
        if (!pl.includes('/rodzina') || pl.includes('loguj')) {
          return false;
        }
        if (pl === '/rodzina' || pl === '/rodzina/') {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    const stuckOnExpiredOrPortalLogin = (h: string): boolean => {
      const l = (h || '').toLowerCase();
      const expired = l.includes('wiadomosci.librus.pl') && l.includes('/session-expired');
      const portalLogin =
        l.includes('portal.librus.pl') &&
        (l.includes('/loguj') || l.includes('synergia/loguj'));
      return expired || portalLogin;
    };

    const waitOptsStuck = {
      earlyFailIf: stuckOnExpiredOrPortalLogin,
      earlyFailAfterSteps: 5,
      earlyFailLog:
        'ustabilizowany session-expired albo portal loguj — przerywam czekanie, kolejna próba / fallback',
    };

    const navigateToSynLoggedIn = async (): Promise<boolean> => {
      const hrefAlready = await this.readWebViewLocationHref('');
      const hrefNorm = this.ensureHttpsLibrusUrl(hrefAlready || '');
      if (postLoginSurface(hrefNorm)) {
        devLog(
          '🔗 Skrzynka: już na zalogowanej Synergii — bez przeładowania przed „Wiadomości”:',
          hrefNorm.length > 120 ? hrefNorm.slice(0, 120) + '…' : hrefNorm
        );
        return true;
      }

      let okSyn = false;
      for (const ent of synEntries) {
        const ee = this.escapeJsSingleQuoted(ent);
        await b.executeScript({
          code: `window.location.href='${ee}';`,
        });
        okSyn = await this.waitUntilIabHref(
          postLoginSurface,
          14000,
          1200,
          `Librus przed skrzynką (${ent.replace('https://', '').slice(0, 56)}…)`,
        );
        if (okSyn) {
          return true;
        }
        devLog(
          `🔗 Skrzynka: wejście ${ent.slice(0, 48)}… nie przyniosło zalogowanej Synergii — następna próba`
        );
      }
      devWarn(
        '🔗 Skrzynka: timeout — nie udaje się wrócić na zalogowaną Synergię przed skrzynką.'
      );
      return false;
    };

    const clickJs = `(function(){
      var warm = '${warmEsc}';
      function go(u){ try { window.location.href = u; } catch(e) {} }
      try {
        var icon = document.getElementById('icon-wiadomosci');
        if (icon) {
          var ah = icon.tagName === 'A' ? icon : (icon.closest && icon.closest('a[href]')) || null;
          if (ah) {
            var fullA = ah.getAttribute('href') || '';
            if (fullA.indexOf('session-expired') < 0) {
              if (fullA.indexOf('http') === 0) {
                if (fullA.indexOf('http://') === 0 && fullA.indexOf('librus.pl') > 0) {
                  fullA = 'https://' + fullA.slice(7);
                }
                window.location.href = fullA;
                return 'icon-wiadomosci-href';
              }
              if (fullA.length > 0) {
                ah.click();
                return 'icon-wiadomosci-anchor-click';
              }
            }
          }
          if (typeof icon.click === 'function') {
            icon.click();
          }
          return 'icon-wiadomosci';
        }
      } catch(e0) {}
      try {
        var nodes = document.querySelectorAll('a[href*="wiadomosci.librus.pl"]');
        var idx, hh, bestEl = null, bestLen = -1;
        for (idx = 0; idx < nodes.length; idx++) {
          hh = nodes[idx].getAttribute('href')||'';
          if (hh.indexOf('session-expired') >= 0) { continue; }
          if (hh.length > bestLen) {
            bestLen = hh.length;
            bestEl = nodes[idx];
          }
        }
        if (bestEl) {
          var full = bestEl.getAttribute('href')||'';
          if (full.indexOf('http') === 0) {
            if (full.indexOf('http://') === 0 && full.indexOf('librus.pl') > 0) {
              full = 'https://' + full.slice(7);
            }
            window.location.href = full;
            return 'assign-sso-link';
          }
          bestEl.click();
          return 'menu-click';
        }
      } catch(e1) {}
      try {
        var rel = document.querySelectorAll('a[href^="/wiadomosci"]');
        for (idx = 0; idx < rel.length; idx++) {
          rel[idx].click();
          return 'relative-wiadomosci';
        }
      } catch(e2) {}
      go(warm);
      return 'warm-direct';
    })();`;

    const tryNavigateWiadFromSynergiaMenu = async (label: string): Promise<boolean> => {
      await new Promise<void>(r => setTimeout(r, 2000));
      await b.executeScript({ code: clickJs });

      const okWd = await this.waitUntilIabHref(
        wdPredicate,
        22000,
        1200,
        label,
        waitOptsStuck
      );

      if (!okWd) {
        return false;
      }

      await this.maybeFollowWiadomosciSsoInterstitial(wdPredicate);

      const hrefPeek = await this.readWebViewLocationHref('');
      if (hrefPeek.includes('/session-expired') || !hrefPeek.includes('wiadomosci.librus.pl')) {
        return false;
      }
      return true;
    };

    if (!(await navigateToSynLoggedIn())) {
      return;
    }

    let opened = await tryNavigateWiadFromSynergiaMenu('Wiadomości po przejściu z Synergii');

    if (!opened) {
      devWarn(
        '🔗 Skrzynka: powtórka SSO — portal …/rodzina/synergia, potem ponownie link „Wiadomości”.'
      );
      await b.executeScript({
        code: `window.location.href='https://portal.librus.pl/rodzina/synergia';`,
      });
      const okPortal = await this.waitUntilIabHref(
        postLoginSurface,
        16000,
        1200,
        'Powierzchnia Librusa po portal …/rodzina/synergia',
      );
      if (okPortal) {
        await new Promise<void>(r => setTimeout(r, 2500));
        opened = await tryNavigateWiadFromSynergiaMenu(
          'Wiadomości (druga próba po portalu)'
        );
      }
    }

    if (!opened) {
      devWarn(
        '🔗 Skrzynka: po próbach SSO nadal brak sesji na wiadomościach — bezpośrednio: ' +
          warm
      );
      await b.executeScript({
        code: `window.location.href='${warmEsc}';`,
      });
      await this.waitUntilIabHref(
        wdPredicate,
        14000,
        1200,
        'Wiadomości (fallback /nowy/)',
        waitOptsStuck
      );
    }

    const hrefAfter = await this.readWebViewLocationHref('');
    if (hrefAfter.includes('session-expired') || !hrefAfter.includes('wiadomosci.librus.pl')) {
      devWarn(
        '🔗 Skrzynka: nie ustawiono ważnej sesji na wiadomościach — dalszy scraping prawdopodobnie zwróci pusto.'
      );
      return;
    }

    await b.executeScript({
      code: `(function(){
        var target = '${finalEsc}';
        try {
          var cur = String(location.href||'');
          var path = '';
          try { path = new URL(target).pathname.replace(/\\/+$/, '') || '/'; } catch(e) {}
          var base = cur.split('#')[0];
          if (path && base.indexOf(path) < 0) {
            window.location.href = target;
          }
        } catch(e2) {}
      })();`,
    });

    await new Promise<void>(r => setTimeout(r, 900));
  }

  /**
   * Czasami po SSO pierwszy load to przekierowanie pośrednie — krótko czekamy na przejście z session-expired.
   */
  private async maybeFollowWiadomosciSsoInterstitial(
    wdPredicate: (h: string) => boolean
  ): Promise<void> {
    const b = this.browser;
    if (!b) {
      return;
    }
    let h = await this.readWebViewLocationHref('');
    if (wdPredicate(h)) {
      return;
    }
    if (!h.includes('wiadomosci.librus.pl') || !h.includes('/session-expired')) {
      return;
    }
    await new Promise<void>(r => setTimeout(r, 1500));
    h = await this.readWebViewLocationHref('');
    if (wdPredicate(h)) {
      return;
    }
    await new Promise<void>(r => setTimeout(r, 4000));
    await this.readWebViewLocationHref('');
  }

  /**
   * Pobiera szczegóły wiadomości (XHR w kontekście wiadomosci.librus.pl — te same ciastka co przeglądarka).
   * Używane po kliknięciu, gdy brak pola body (np. stary wpis z DOM).
   */
  async fetchInboxMessageDetail(messageId: string): Promise<Partial<Message> | null> {
    const id = String(messageId || '').trim();
    if (!/^\d+$/.test(id)) {
      devWarn('fetchInboxMessageDetail: pomijam — oczekiwany numeryczny messageId z API');
      return null;
    }
    try {
      const script = this.scraperService.getMessageDetailApiScript(id);
      const raw = await this.scrapeSection(
        'https://wiadomosci.librus.pl/nowy/inbox',
        script
      );
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const obj = raw as Record<string, unknown>;
      const body =
        typeof obj['body'] === 'string'
          ? (obj['body'] as string)
          : undefined;
      if (!body || !body.trim()) {
        return null;
      }
      return {
        id: String(obj['id'] ?? id),
        body,
        subject: typeof obj['subject'] === 'string' ? (obj['subject'] as string) : undefined,
        sender: typeof obj['sender'] === 'string' ? (obj['sender'] as string) : undefined,
        sendDateIso:
          typeof obj['sendDateIso'] === 'string' ? (obj['sendDateIso'] as string) : undefined,
        date: typeof obj['date'] === 'string' ? (obj['date'] as string) : undefined,
        isRead: obj['isRead'] === true ? true : undefined,
        hasAttachment: obj['hasAttachment'] === true ? true : undefined
      };
    } catch (e) {
      devWarn('fetchInboxMessageDetail: błąd', e);
      return null;
    } finally {
      this.browser?.hide();
    }
  }

  /**
   * Wartość jak w przeglądarce: używamy ciastka `DZIENNIKSID` jeśli jest w słoiku.
   * Gdy nie — `SDZIENNIKSID` bywa samym hashem lub pełnym `Axx~hash`; bez zgadywania prefiksów
   * szukamy w całym słoiku wpisu wartości `…~{hash}`, żeby skopiować literalnie jak w DevTools.
   */
  private dziennikSidForWiadomosciFromSynergiaJar(
    synergiaJar: Record<string, string>
  ): string | null {
    const full =
      synergiaJar['DZIENNIKSID'] != null ? String(synergiaJar['DZIENNIKSID']).trim() : '';
    if (full.length > 0) {
      return full;
    }
    const sdRaw =
      synergiaJar['SDZIENNIKSID'] != null ? String(synergiaJar['SDZIENNIKSID']).trim() : '';
    if (sdRaw.length === 0) {
      return null;
    }
    if (/^[A-Za-z0-9_]+~/.test(sdRaw)) {
      return sdRaw;
    }
    /** Sam hash bez „Axx~”: pełny DZIENNIKSID czasem pojawia się pod inną nazwą w tym samym słoiku. */
    const hash = sdRaw;
    let bestFromJar: string | null = null;
    for (const v of Object.values(synergiaJar)) {
      const s = String(v ?? '').trim();
      if (
        s.length > hash.length &&
        s.includes('~') &&
        /^[A-Za-z0-9_]+~/.test(s) &&
        s.endsWith(hash)
      ) {
        if (bestFromJar === null || s.length < bestFromJar.length) {
          bestFromJar = s;
        }
      }
    }
    if (bestFromJar !== null) {
      devLog('🍪 DZIENNIKSID: użyto pełnej wartości z innego pola słoika (jak w przeglądarce)');
      return bestFromJar;
    }
    devWarn(
      '🍪 W natywnym słoiku brak pełnego DZIENNIKSID — jest tylko fragment bez „Axx~”; nie tworzymy sztucznego prefiksu.'
    );
    return null;
  }

  private jarToCookieHeader(jar: Record<string, string>): string {
    return Object.entries(jar)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('; ');
  }

  /** Parsuje `document.cookie` (tylko ciastka nie-HttpOnly) — pierwsze `=` dzieli klucz/wartość. */
  private parseBrowserCookieString(cookieString: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of cookieString.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Scala słoiki Capacitor (wszystkie `capacitorJarOrigins`). Wartości niepuste nadpisują wcześniejsze klucze.
   */
  private async mergeCapacitorJarsForRodzic(): Promise<Record<string, string>> {
    const merged: Record<string, string> = {};
    if (!Capacitor.isNativePlatform()) {
      return merged;
    }
    for (const origin of this.rodzicCookieJarMergeOrder) {
      try {
        const jar = await CapacitorCookies.getCookies({ url: origin });
        for (const [k, v] of Object.entries(jar || {})) {
          if (v != null && String(v) !== '') {
            merged[k] = String(v);
          }
        }
      } catch {
        /* noop */
      }
    }
    return merged;
  }

  /**
   * Buduje nagłówek Cookie dla GET `…/rodzic/index`: kolejność jak w przeglądarce, kanoniczny `DZIENNIKSID`
   * (jak `dziennikSidForWiadomosciFromSynergiaJar`), domyślne `TestCookie=1` i `access_denied_login_url` gdy brak.
   */
  private buildRodzicCapacitorHttpCookieHeader(jarMerged: Record<string, string>): string {
    const m: Record<string, string> = { ...jarMerged };
    const canonicalDz = this.dziennikSidForWiadomosciFromSynergiaJar(m);
    if (canonicalDz) {
      m['DZIENNIKSID'] = canonicalDz;
    }
    if (!m['TestCookie']?.trim()) {
      m['TestCookie'] = '1';
    }
    if (!m['access_denied_login_url']?.trim()) {
      m['access_denied_login_url'] = this.rodzicDefaultAccessDeniedLoginUrl;
    }
    const parts: string[] = [];
    for (const key of this.rodzicCookieHeaderKeyOrder) {
      const v = m[key];
      if (v != null && String(v).length > 0) {
        parts.push(`${key}=${String(v)}`);
      }
    }
    return parts.join('; ');
  }

  /**
   * Skrzynka czyta inny host niż Synergia. CapacitorHttp widzi osobny słoik —
   * kopiujemy pełne DZIENNIKSID ze słoika / skanując wartości z sufiksem jak SDZIENNIKSID —
   * bez wymyślania prefiksu Axx —
   * żeby dograć m.in. cookiesession1 jak w przeglądarce.
   */
  private async prepareWiadomosciCapacitorCookiesAfterSynergia(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      devLog(
        '🍪 [prepare wiadomości] początek: odczyt natywnego słoika synergia → ewentualny CapacitorHttp GET /nowy/'
      );
      const synergiaJar = await CapacitorCookies.getCookies({
        url: this.LIBR_SYNERGIA_COOKIE_URL,
      });
      const canonical = this.dziennikSidForWiadomosciFromSynergiaJar(synergiaJar);
      if (!canonical) {
        const sk = Object.keys(synergiaJar || {}).sort();
        devLog(
          '🍪 [prepare wiadomości] STOP — brak DZIENNIKSID ze słoika synergii; nie wywołuję CapacitorHttp ani nie mam czego policzyć jako nagłówek Cookie dla /nowy/. Klucze synergia:',
          sk.length ? sk.join(', ') : '(pusty magazyn — typowe przy samym WebView/IAB bez mostka do Ciastek)'
        );
        return;
      }

      const wdBefore = await CapacitorCookies.getCookies({
        url: this.LIBR_WIADOMOSCI_COOKIE_URL,
      });
      const prev = wdBefore['DZIENNIKSID'] != null ? String(wdBefore['DZIENNIKSID']) : '';
      if (prev !== canonical) {
        await CapacitorCookies.setCookie({
          url: this.LIBR_WIADOMOSCI_COOKIE_URL,
          key: 'DZIENNIKSID',
          value: canonical,
          path: '/',
        });
        devLog(
          '🍪 DZIENNIKSID: skopiowany z pola Synergii do wiadomości (CapacitorCookies).'
        );
      }

      const wd = await CapacitorCookies.getCookies({
        url: this.LIBR_WIADOMOSCI_COOKIE_URL,
      });
      const ch = this.jarToCookieHeader(wd).trim();
      if (!ch) {
        devLog(
          '🍪 [prepare wiadomości] STOP — po setCookie magazyn wiadomosci.librus.pl nadal bez par klucz=wartość; brak wywołania CapacitorHttp.'
        );
        return;
      }
      devLog(
        `🌡️ CapacitorHttp GET …/nowy/ — pełny nagłówek Cookie (${ch.length} zn., jak w przeglądarce dla tej domeny):`,
        ch
      );
      await CapacitorHttp.get({
        url: `${this.LIBR_WIADOMOSCI_COOKIE_URL}/nowy/`,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          Cookie: ch,
        },
      });
      devLog('🌡️ GET wiadomosci/nowy/ (CapacitorHttp): dogrywanie cookiesession1 itp.');
    } catch (err) {
      devWarn(
        '⚠️ Przygotowanie ciastek wiadomości po Synergii: pomijam (brak dostępu do słoika?):',
        err
      );
    }
  }

  /** Ten sam warmup w Cordova WebView co już jest zalogowany do Synergii — Set-Cookie na wiadomosci. */
  private async warmupWiadomosciCordovaCookiesAfterSynergia(): Promise<void> {
    if (!this.browser) {
      return;
    }
    try {
      const raw = await this.browser.executeScript({
        code:
          `(function(){ try {\n          var xhr = new XMLHttpRequest();\n          xhr.open('GET', 'https://wiadomosci.librus.pl/nowy/', false);\n          xhr.setRequestHeader('Accept', 'text/html,*/*');\n          xhr.withCredentials = true;\n          xhr.send(null);\n          return JSON.stringify({ status: xhr.status });\n        } catch(e) {\n          return JSON.stringify({ err: String(e.message || e) });\n        } })();`,
      });
      const txt = typeof raw?.[0] === 'string' ? raw[0] : JSON.stringify(raw);
      devLog('🌡️ Warm-up wiadomości w InAppBrowser (XHR /nowy/):', txt?.slice(0, 220));
      if (txt && txt.includes('"err"')) {
        devLog(
          'ℹ️ Synchroniczny XHR z innego hosta w WebView często jest blokowany (CORS/ polityka). Dogrywanie ciastek robi CapacitorHttp + DZIENNIKSID w natywnym słoiku.'
        );
      }
    } catch {
      /* noop */
    }
  }

  /**
   * Wyłącznie host **synergia** + znane ścieżki po pełnym SSO.
   * NIE używać samego portal …/rodzina — to bywa ekran przed wpisaniem hasła (fałszywy „zalogowany”).
   */
  private urlStrictSynergiaSessionForWiadomosciHop(eventUrl: string): boolean {
    const l = eventUrl.toLowerCase();
    if (!l.includes('synergia.librus.pl')) {
      return false;
    }
    if (l.includes('/loguj') || l.includes('synergia/loguj')) {
      return false;
    }
    return (
      l.includes('synergia.librus.pl/uczen/index') ||
      l.includes('synergia.librus.pl/rodzina/index') ||
      l.includes('synergia.librus.pl/przegladaj') ||
      (l.includes('synergia.librus.pl/rodzic') && !l.includes('loguj'))
    );
  }

  /**
   * Podstrony Synergii z tym samym górnym menu co „Oceny … Wiadomości” —
   * po sync (np. /terminarz) `navigateToSynLoggedIn` nie powinien przeładowywać na `/`.
   */
  private urlSynergiaLoggedSubpageWithMessagesMenu(h: string): boolean {
    try {
      const u = new URL(this.ensureHttpsLibrusUrl(h));
      if (!u.hostname.toLowerCase().includes('synergia.librus.pl')) {
        return false;
      }
      const l = h.toLowerCase();
      if (l.includes('/loguj') || l.includes('synergia/loguj')) {
        return false;
      }
      let pl = (u.pathname || '/').toLowerCase();
      pl = pl.replace(/\/+$/, '') || '/';
      if (pl === '/' || pl === '') {
        return false;
      }
      const roots = [
        '/ogloszenia',
        '/terminarz',
        '/frekwencja',
        '/wiadomosci',
        '/wiadomosci3',
        '/zadania_domowe',
        '/zadania-domowe',
      ];
      return roots.some(r => pl === r || pl.startsWith(`${r}/`));
    } catch {
      return false;
    }
  }

  /** Czy jesteśmy na Synergii na ekranie, z którego da wejść w menu w „Wiadomości”. */
  private synergiaWebViewReadyForWiadomosciMenuClick(h: string): boolean {
    return (
      this.urlStrictSynergiaSessionForWiadomosciHop(h) ||
      this.urlSynergiaLoggedSubpageWithMessagesMenu(h)
    );
  }

  /** Te same heurystyki co przy `awaitingLogin` w `scrapeSection` (Synergia / portal rodzina). */
  private urlIndicatesSuccessfulLibrusLogin(eventUrl: string): boolean {
    const urlLower = eventUrl.toLowerCase();
    const synergiaLoggedIn =
      urlLower.includes('synergia.librus.pl/uczen/index') ||
      urlLower.includes('synergia.librus.pl/rodzina/index') ||
      urlLower.includes('synergia.librus.pl/rodzic/') ||
      (urlLower.includes('synergia.librus.pl') &&
        !urlLower.includes('/loguj') &&
        !urlLower.includes('synergia/loguj'));

    let portalRodzicaPoLogowaniu = false;
    try {
      const eu = new URL(eventUrl);
      const pl = eu.pathname.toLowerCase();
      portalRodzicaPoLogowaniu =
        eu.hostname.includes('portal.librus.pl') &&
        pl.includes('/rodzina') &&
        !pl.includes('loguj');
    } catch {
      portalRodzicaPoLogowaniu = false;
    }

    return synergiaLoggedIn || portalRodzicaPoLogowaniu;
  }

  /**
   * Tryb testowy: pierwszy loadstop świadczący o zalogowaniu → mostek na wiadomości → STOP.
   * Nie wywołuje `browser.hide()`, nie uruchamia DOM scrapingu.
   */
  private async waitForLoginEventThenOpenWiadomoscKeepBrowser(): Promise<boolean> {
    this.tearDownScrapeLoadStop();

    const loginUrl = 'https://portal.librus.pl/rodzina/synergia/loguj';
    const wiadomTarget = 'https://wiadomosci.librus.pl/nowy/inbox';

    if (!this.browser) {
      this.browser = this.iab.create(
        loginUrl,
        '_blank',
        'location=yes,hidden=no,clearcache=no,clearsessioncache=no,cleardata=no'
      );
      devLog(`🧪 TEST: nowe IAB — ${loginUrl}`);
    } else {
      devLog('🧪 TEST: istniejące IAB — show + powrót na logowanie');
      await this.browser.show();
      await this.browser.executeScript({
        code: `window.location.href = ${JSON.stringify(loginUrl)};`,
      });
    }

    return new Promise<boolean>(resolve => {
      this.scrapeGeneration += 1;
      const gen = this.scrapeGeneration;
      let finished = false;
      let subscription: Subscription | undefined;

      const cleanupSubscription = (): void => {
        try {
          subscription?.unsubscribe();
        } catch {
          /* noop */
        }
        subscription = undefined;
        this.scrapeLoadStopSub = null;
      };

      const watchdog = setTimeout(() => {
        if (finished || gen !== this.scrapeGeneration) {
          return;
        }
        finished = true;
        cleanupSubscription();
        devWarn(
          '🧪 TEST: timeout 120 s — brak URL zalogowania; przeglądarki nie chowam.'
        );
        resolve(false);
      }, 120_000);

      const onLoginDetected = async (loggedInUrl: string): Promise<void> => {
        if (finished || gen !== this.scrapeGeneration) {
          return;
        }
        finished = true;
        clearTimeout(watchdog);
        cleanupSubscription();

        devLog('🧪 TEST: ✅ Wykryto zalogowanie (loadstop):', loggedInUrl);
        try {
          await this.markSessionActive();
          devLog('🧪 TEST: marker sesji zapisany.');
          devLog(`🧪 TEST: SSO → wiadomości (${wiadomTarget})…`);
          await this.openWiadomosciViaSynergiaSsoBridge(wiadomTarget);
          devLog(
            '🧪 TEST: STOP — bez parsowania; IAB bez hide() (zostaje na ekranie).'
          );
          resolve(true);
        } catch (err) {
          devWarn('🧪 TEST: wyjątek po logowaniu (IAB otwarte):', err);
          resolve(true);
        }
      };

      subscription = this.browser!.on('loadstop').subscribe((event: InAppBrowserEvent) => {
        if (finished || gen !== this.scrapeGeneration) {
          return;
        }
        devLog(`🧪 TEST loadstop: ${event.url}`);
        this.syncDemoRecordingBlurForWebView(event.url);
        if (!this.urlStrictSynergiaSessionForWiadomosciHop(event.url)) {
          return;
        }
        void onLoginDetected(event.url);
      });

      this.scrapeLoadStopSub = subscription;
    });
  }

  // Główna metoda synchronizacji wszystkich danych
  async syncAllData(options?: SyncAllOptions): Promise<SyncResult> {
    if (this.syncAllDataInFlight) {
      devLog('⏳ syncAllData już trwa — pomijam równoległe wywołanie.');
      return {
        success: false,
        newGrades: 0,
        newMessages: 0,
        newNotes: 0,
        newAnnouncements: 0,
        newEvents: 0,
        error: 'Synchronizacja już trwa.',
      };
    }
    this.syncAllDataInFlight = true;

    devLog('🔄 Rozpoczynam pełną synchronizację danych...');

    this.domScrapeUiGateDoneForSync = false;
    this.pendingDomScrapeBeginCallback = options?.onDomScrapeBegin;

    const onProgress = options?.onProgress;
    const emit = (message: string, percent: number): void => {
      const pct = Math.min(100, Math.max(0, Math.round(percent)));
      onProgress?.({ message, percent: pct });
    };
    
    const result: SyncResult = {
      success: false,
      newGrades: 0,
      newMessages: 0,
      newNotes: 0,
      newAnnouncements: 0,
      newEvents: 0
    };

    try {
      if (this.TEST_SYNC_LOGIN_ONLY_NAV_WIADOMOSCI) {
        devLog(
          '🧪 TRYB TESTU SYNC (`TEST_SYNC_LOGIN_ONLY_NAV_WIADOMOSCI`): wyłączone oceny/wiadomości/rest. Ustaw `= true` w `librus-auth.ts` na chwilę testu mostka.'
        );
        emit('Tryb testu — oczekiwanie na logowanie…', 50);
        result.success =
          await this.waitForLoginEventThenOpenWiadomoscKeepBrowser();
        if (!result.success) {
          result.error = 'TEST: brak URL zalogowania w 120 s';
        }
        emit(
          result.success ? 'Test zakończony.' : 'Test — przekroczono czas.',
          100
        );
        return result;
      }

      emit('Rozpoczynam synchronizację…', 0);

      const GRADES_LO = 2;
      const GRADES_HI = 22;

      // 1. Pobierz oceny
      devLog('📚 Synchronizacja ocen...');
      emit('Oceny — ładowanie strony w przeglądarce…', GRADES_LO);
      const gradesData = await this.scrapeSection(
        'https://synergia.librus.pl/przegladaj_oceny/uczen',
        this.scraperService.getGradesScript(),
        {
          chunkedGrades: true,
          onGradesChunkProgress: (index, parts) => {
            const span = GRADES_HI - GRADES_LO;
            const pct =
              GRADES_LO + (span * (index + 1)) / Math.max(1, parts);
            emit(
              `Oceny — pobieranie pakietu ${index + 1} z ${parts}…`,
              pct
            );
          }
        }
      );
      
      devLog(
        '📦 Surowe dane ocen:',
        gradesData !== null && Array.isArray(gradesData)
          ? `tablica ${gradesData.length} przedmiotów`
          : String(gradesData)
      );
      
      if (gradesData !== null && gradesData !== undefined) {
        const grades = this.scraperService.parseGrades(gradesData as any[]);
        devLog('✅ Sparsowane oceny JSON:', JSON.stringify(grades));
        
        const { data: markedGrades, newCount } = await this.storageService.compareAndMarkNew('grades', grades);
        await this.storageService.saveData({ grades: markedGrades });
        result.newGrades = newCount;
        devLog(`✅ Oceny: ${newCount} nowych, razem ${grades.length} przedmiotów`);
      } else {
        devLog('⚠️ Brak danych ocen - scraping zwrócił null/undefined');
      }

      emit('Oceny — zapis i porównanie…', 24);

      // 2. Ogłoszenia i terminarz (Synergia) — przed wejściem w Wiadomości (mostek SSO + skrzynka).
      devLog('📢 Synchronizacja ogłoszeń...');
      emit('Ogłoszenia — ładowanie strony…', 28);
      const announcementsData = await this.scrapeSection(
        'https://synergia.librus.pl/ogloszenia',
        this.scraperService.getAnnouncementsScript()
      );

      if (announcementsData !== null && announcementsData !== undefined) {
        const announcements = this.scraperService.parseAnnouncements(announcementsData as any[]);
        const { data: markedAnnouncements, newCount } = await this.storageService.compareAndMarkNew(
          'announcements',
          announcements
        );
        await this.storageService.saveData({ announcements: markedAnnouncements });
        result.newAnnouncements = newCount;
        devLog(`✅ Ogłoszenia: ${newCount} nowych`);
      }

      emit('Ogłoszenia — zapis…', 34);

      devLog('📅 Synchronizacja terminarza...');
      emit('Terminarz — ładowanie strony…', 38);
      const calendarData = await this.scrapeSection(
        'https://synergia.librus.pl/terminarz',
        this.scraperService.getCalendarScript()
      );

      if (calendarData !== null && calendarData !== undefined) {
        const calendar = this.scraperService.parseCalendar(calendarData as any[]);
        const { data: markedCalendar, newCount } = await this.storageService.compareAndMarkNew(
          'calendar',
          calendar
        );
        await this.storageService.saveData({ calendar: markedCalendar });
        result.newEvents = newCount;
        devLog(`✅ Wydarzenia: ${newCount} nowych`);
      }

      emit('Terminarz — zapis…', 44);

      emit('Wiadomości — synchronizacja ciasteczek i sesji…', 48);
      await this.prepareWiadomosciCapacitorCookiesAfterSynergia();
      await this.warmupWiadomosciCordovaCookiesAfterSynergia();
      await this.logCapacitorCookieJarKeysBrief('Sync, po przygotowaniu wiadomości');

      // 3. Wiadomości — po Synergii: `scrapeSection` odpali mostek (klik „Wiadomości”) gdy potrzeba.
      devLog('📬 Synchronizacja wiadomości...');
      emit('Wiadomości — pobieranie skrzynki…', 54);
      let messagesData = await this.wiadomosciMsgsApi.tryFetchAllInboxMessagesMappedToScraperShape();
      const messagesFromRestApi = !!messagesData;
      if (!messagesData) {
        messagesData = await this.scrapeSection(
          'https://wiadomosci.librus.pl/nowy/inbox',
          this.scraperService.getMessagesScript()
        );
      } else {
        devLog(`📬 Wiadomości: pobrano przez REST (bez pełnego scrapu DOM): ${messagesData.length} pozycji`);
      }

      if (messagesData !== null && messagesData !== undefined) {
        devLog('📦 Surowe dane wiadomości JSON:', JSON.stringify(messagesData));
        const messages = this.scraperService.parseMessages(messagesData as any[]);
        devLog('✅ Sparsowane wiadomości JSON:', JSON.stringify(messages));
        const { data: markedMessages, newCount } = await this.storageService.compareAndMarkNew('messages', messages);
        await this.storageService.saveData({ messages: markedMessages });
        result.newMessages = newCount;
        devLog(`✅ Wiadomości: ${newCount} nowych, razem ${messages.length}`);
      } else {
        devLog('⚠️ Brak danych wiadomości - scraping zwrócił null/undefined');
      }

      emit('Wiadomości — zapis…', 66);

      devLog('📝 Synchronizacja uwag...');
      emit('Uwagi — ładowanie strony…', 70);
      const notesData = await this.scrapeSection(
        'https://wiadomosci.librus.pl/nowy/inbox-notes',
        this.scraperService.getNotesScript(),
        {
          skipWiadomosciSsoBridge:
            !messagesFromRestApi && messagesData !== null && messagesData !== undefined
        }
      );

      if (notesData !== null && notesData !== undefined) {
        devLog('📦 Surowe dane uwag JSON:', JSON.stringify(notesData));
        const notes = this.scraperService.parseNotes(notesData as any[]);
        devLog('✅ Sparsowane uwagi JSON:', JSON.stringify(notes));
        const { data: markedNotes, newCount } = await this.storageService.compareAndMarkNew('notes', notes);
        await this.storageService.saveData({ notes: markedNotes });
        result.newNotes = newCount;
        devLog(`✅ Uwagi: ${newCount} nowych, razem ${notes.length}`);
      } else {
        devLog('⚠️ Brak danych uwag - scraping zwrócił null/undefined');
      }

      emit('Uwagi — zapis…', 82);

      result.success = true;
      devLog('🎉 Synchronizacja zakończona sukcesem!');

      await this.markSessionActive();

      if (environment.simulateDeferredHttpAfterSync) {
        emit('[HTTP-AFTER-SYNC] Test HTTP — czekam 5 s (IAB otwarte, sesja w WebView)…', 93);
        console.log(
          '[HTTP-AFTER-SYNC] waiting 5s — InAppBrowser stays OPEN (session cookies are in IAB WebView, not Capacitor jar)…'
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await this.runDeferredHttpPingAfterSync();
      }

      emit('Kończenie — zamykanie przeglądarki…', 92);

      this.closeInAppBrowserAfterSync('sukces synchronizacji');

      emit('Synchronizacja zakończona.', 100);

      void notifyLocalSyncCompletedForTest();

      return result;

    } catch (error) {
      console.error('❌ Błąd podczas synchronizacji:', error);
      const errorMsg = typeof error === 'string' ? error : '';
      result.error = errorMsg || 'Błąd synchronizacji';
      
      // WAŻNE: NIE ukrywaj przeglądarki jeśli to błąd logowania!
      // Przeglądarka jest już pokazana przez scrapeSection()
      if (!errorMsg.includes('logowanie') && !errorMsg.includes('wygasła')) {
        this.closeInAppBrowserAfterSync('błąd synchronizacji (nie logowanie)');
      } else {
        devLog('🔑 Przeglądarka pozostaje widoczna - wymagane logowanie');
      }
      
      return result;
    } finally {
      this.pendingDomScrapeBeginCallback = undefined;
      this.syncAllDataInFlight = false;
    }
  }
  private async scrapeSection(
    url: string,
    script: string,
    options?: {
      chunkedGrades?: boolean;
      skipWiadomosciSsoBridge?: boolean;
      onGradesChunkProgress?: (index: number, total: number) => void;
    }
  ): Promise<any> {
    if (
      this.browser &&
      url.includes('wiadomosci.librus.pl') &&
      !options?.skipWiadomosciSsoBridge
    ) {
      await this.openWiadomosciViaSynergiaSsoBridge(url);
    }

    return new Promise((resolve, reject) => {
      const chunkedGrades = options?.chunkedGrades === true;
      let createdForLogin = false;

      if (!this.browser) {
        createdForLogin = true;
        this.browser = this.iab.create(
          'https://portal.librus.pl/rodzina/synergia/loguj',
          '_blank',
          'location=yes,hidden=no,clearcache=no,clearsessioncache=no,cleardata=no'
        );
        devLog(`🔑 Brak aktywnej przeglądarki - otwieram logowanie przed synchronizacją: ${url}`);
      } else {
        if (url.includes('wiadomosci.librus.pl')) {
          const targetEsc = this.escapeJsSingleQuoted(url);
          devLog(`🔄 Skrzynka: po łańcuchu SSO dopinam ścieżkę (gdy trzeba): ${url}`);
          this.browser.executeScript({
            code: `(function(){
              var target = '${targetEsc}';
              try {
                var cur = String(location.href||'');
                var path = '';
                try { path = new URL(target).pathname.replace(/\\/+$/, '') || '/'; } catch(e) {}
                if (path && cur.split('#')[0].indexOf(path) < 0) {
                  window.location.href = target;
                }
              } catch(e2) {}
            })();`,
          });
        } else {
          const navUrl = this.getWiadomosciWarmStartUrl(url);
          devLog(
            `🔄 Nawiguję do: ${navUrl}${navUrl !== url ? ` (odpycham docelową sekcję: ${url})` : ''}`
          );
          this.browser.executeScript({ code: `window.location.href = '${this.escapeJsSingleQuoted(navUrl)}';` });
        }
      }

      this.scrapeGeneration += 1;
      const scrapeGen = this.scrapeGeneration;
      const sectionNavStartedAt = Date.now();
      this.tearDownScrapeLoadStop();

      let scrapingDone = false;
      let scrapingInProgress = false;
      let awaitingLogin = createdForLogin;
      let wrongPathRedirects = 0;
      let portalStuckFallbackTimer: ReturnType<typeof setTimeout> | null = null;
      let sectionTimeout: ReturnType<typeof setTimeout> | null = null;
      let loginTimeout: ReturnType<typeof setTimeout> | null = null;
      let scrapeWatchdog: ReturnType<typeof setTimeout> | null = null;
      /** Blokuje równoległe loadstopy podczas `openWiadomosciViaSynergiaSsoBridge` po zalogowaniu. */
      let loginBridgeBusy = false;
      let subscription: Subscription | undefined;

      const clearPortalStuckFallbackTimer = (): void => {
        if (portalStuckFallbackTimer) {
          clearTimeout(portalStuckFallbackTimer);
          portalStuckFallbackTimer = null;
        }
      };

      const detachScrapeListener = (): void => {
        clearPortalStuckFallbackTimer();
        try {
          subscription?.unsubscribe();
        } catch {
          /* noop */
        }
        this.scrapeLoadStopSub = null;
      };

      const clearScrapeWatchdog = () => {
        if (scrapeWatchdog) {
          clearTimeout(scrapeWatchdog);
          scrapeWatchdog = null;
        }
      };

      const armScrapeWatchdog = () => {
        clearScrapeWatchdog();
        scrapeWatchdog = setTimeout(() => {
          if (scrapingDone || awaitingLogin) {
            return;
          }
          devLog('⏱️ Timeout podczas scrapingu (executeScript/DOM)');
          scrapingDone = true;
          scrapingInProgress = false;
          clearSectionTimeout();
          clearScrapeWatchdog();
          detachScrapeListener();
          this.browser?.hide();
          resolve(null);
        }, 90000);
      };

      const clearSectionTimeout = () => {
        if (sectionTimeout) {
          clearTimeout(sectionTimeout);
          sectionTimeout = null;
        }
      };

      const startSectionTimeout = () => {
        clearSectionTimeout();
        sectionTimeout = setTimeout(() => {
          if (!scrapingDone && !awaitingLogin) {
            scrapingDone = true;
            scrapingInProgress = false;
            clearScrapeWatchdog();
            detachScrapeListener();
            this.browser?.hide();
            devLog('⏱️ Timeout - sekcja nie załadowała się w czasie');
            resolve(null);
          }
        }, 60000);
      };

      const requestManualLogin = async (reason: string, redirectToLogin: boolean) => {
        if (awaitingLogin || scrapingDone) {
          return;
        }

        clearPortalStuckFallbackTimer();

        // Odblokuj loadstop dla kolejnego kroku (logowanie / redirect)
        scrapingInProgress = false;
        clearScrapeWatchdog();
        awaitingLogin = true;
        clearSectionTimeout();
        if (loginTimeout) {
          clearTimeout(loginTimeout);
        }
        devLog(`⚠️ ${reason}`);
        devLog('🔑 Pokazuję okno logowania i czekam na zalogowanie...');

        /** Ponowne logowanie — następny scraping znów ma schować IAB i pokazać preloader w aplikacji. */
        this.domScrapeUiGateDoneForSync = false;

        /** Nie czyścimy Preferences — HttpOnly i tak siedzą w WebView; clearSession() psuł UX (ciągłe „wylogowanie”). */
        this.browser?.show();

        if (redirectToLogin) {
          this.browser?.executeScript({
            code: "window.location.href = 'https://portal.librus.pl/rodzina/synergia/loguj';"
          });
        }

        void (async () => {
          try {
            const href = await this.readWebViewLocationHref('');
            this.syncDemoRecordingBlurForWebView(
              href && href.length > 0 ? href : 'https://portal.librus.pl/rodzina/synergia/loguj'
            );
          } catch {
            this.syncDemoRecordingBlurForWebView('https://portal.librus.pl/rodzina/synergia/loguj');
          }
        })();

        loginTimeout = setTimeout(() => {
          if (awaitingLogin && !scrapingDone) {
            scrapingDone = true;
            scrapingInProgress = false;
            clearScrapeWatchdog();
            detachScrapeListener();
            devLog('⏱️ Timeout logowania ręcznego');
            this.browser?.hide();
            resolve(null);
          }
        }, 120000);
      };

      const wiadomSkrzynkaBezRelog = this.isWiadomosciMailboxSectionWithoutForcedRelog(url);

      const finishInboxWiadWithoutRelog = (reason: string): void => {
        if (scrapingDone) {
          return;
        }
        devWarn(`📬 Skrzynka / uwagi (wiadomosci/nowy): kończę bez wymuszania logowania — ${reason}`);
        awaitingLogin = false;
        if (loginTimeout) {
          clearTimeout(loginTimeout);
          loginTimeout = null;
        }
        scrapingDone = true;
        scrapingInProgress = false;
        this.domScrapeRunning = false;
        clearPortalStuckFallbackTimer();
        clearScrapeWatchdog();
        clearSectionTimeout();
        detachScrapeListener();
        this.browser?.hide();
        resolve(null);
      };

      const armPortalStuckFallbackTimer = (): void => {
        if (portalStuckFallbackTimer || scrapingDone) {
          return;
        }
        portalStuckFallbackTimer = setTimeout(async () => {
          portalStuckFallbackTimer = null;
          if (
            scrapeGen !== this.scrapeGeneration ||
            scrapingDone ||
            awaitingLogin ||
            scrapingInProgress
          ) {
            return;
          }
          try {
            const want = new URL(url);
            const raw = await this.browser?.executeScript({
              code: '(function(){ return JSON.stringify(window.location.href); })()'
            });
            const parsed = this.parseBridgeScriptResult(raw?.[0]);
            const hrefStr = typeof parsed === 'string' ? parsed.trim() : '';
            if (!hrefStr || hrefStr.indexOf('http') !== 0) {
              return;
            }
            const got = new URL(hrefStr);
            const stillPortal =
              got.hostname.includes('portal.librus.pl') &&
              !hrefStr.includes('/loguj');
            if (
              stillPortal &&
              this.targetUsesPortalSsoHop(url) &&
              got.hostname !== want.hostname
            ) {
              devLog(
                '⚠️ Nadal portal po czasie SSO — uruchamiam logowanie:',
                hrefStr
              );
              if (wiadomSkrzynkaBezRelog) {
                finishInboxWiadWithoutRelog(
                  'portal SSO nie przeszedł do skrzynki — pomijam wymuszenie logowania'
                );
              } else {
                await requestManualLogin(
                  'Sesja wygasła lub przeglądarka nie przeszła do Librusa — zaloguj się ponownie.',
                  true
                );
              }
            }
          } catch {
            /* noop */
          }
        }, 14000);
      };

      const processScrapeLoadStop = async (event: InAppBrowserEvent): Promise<void> => {
        if (scrapeGen !== this.scrapeGeneration) {
          return;
        }
        if (loginBridgeBusy) {
          return;
        }
        if (scrapingDone || scrapingInProgress) return;

        const librusHttps = this.ensureHttpsLibrusUrl(event.url);
        if (librusHttps !== event.url && this.browser) {
          devWarn(
            '📍 Cleartext na domenie Librus — zamiana na HTTPS:',
            event.url.slice(0, 120)
          );
          await this.browser.executeScript({
            code: `window.location.replace('${this.escapeJsSingleQuoted(librusHttps)}');`,
          });
          return;
        }

        devLog(`📍 Załadowono: ${event.url}`);

        /**
         * Dla celu `wiadomosci.*`: zawsze czytaj faktyczny href — `event.url` bywa przeterminowany
         * (nadal synergia termin r. / oceny), przez co przez długi czas nie wchodzimy w `shouldScrape`.
         */
        let probeUrl = event.url;
        if (url.includes('wiadomosci.librus.pl')) {
          probeUrl = await this.readWebViewLocationHref(event.url);
          if (probeUrl !== event.url) {
            devLog(`🔗 WebView faktyczny href (różnica od loadstop): ${probeUrl}`);
          }
        }

        this.syncDemoRecordingBlurForWebView(probeUrl);

        if (probeUrl.includes('/session-expired')) {
          /** Nawigacja ogłoszeń/ocen może dostać jeszcze loadstop ze starego WebView wiadomości — nie traktować jak Synergii. */
          try {
            const pu = new URL(probeUrl).hostname;
            const want = new URL(url).hostname;
            if (
              pu.includes('wiadomosci.librus.pl') &&
              want.includes('synergia.librus.pl')
            ) {
              devLog(
                '📍 Pomijam /session-expired na wiadomosci (stale loadstop przy sync Synergii) →',
                (() => {
                  try {
                    return new URL(url).pathname;
                  } catch {
                    return url;
                  }
                })()
              );
              return;
            }
          } catch {
            /* noop */
          }
          if (wiadomSkrzynkaBezRelog) {
            finishInboxWiadWithoutRelog('adres WebView zawiera /session-expired');
            return;
          }
          await requestManualLogin('Sesja wygasła na domenie wiadomości Librusa!', true);
          return;
        }

        let forceScrapeThisStop = false;

        /**
         * Po wykryciu zalogowanej sesji WebView ustaw docelową sekcję synchronizacji.
         * Skrzynka na innym hoście — pełny mostek Synergia → wiadomości (nie samo `/nowy/`), żeby zgadzała się sesja SPA.
         */
        const completeLoginAndNavigateToSection = async (logLine: string): Promise<void> => {
          devLog(logLine);
          awaitingLogin = false;
          if (loginTimeout) {
            clearTimeout(loginTimeout);
            loginTimeout = null;
          }
          await this.markSessionActive();

          this.browser?.show();
          startSectionTimeout();
          if (url.includes('wiadomosci.librus.pl')) {
            devLog(
              '🔗 Po logowaniu: najpierw łańcuch Synergia → wiadomości, potem docelowa ścieżka skrzynki (przed scrapingiem DOM).'
            );
            loginBridgeBusy = true;
            try {
              await this.openWiadomosciViaSynergiaSsoBridge(url);
            } finally {
              loginBridgeBusy = false;
            }
            return;
          }
          const resumeUrlEsc = this.escapeJsSingleQuoted(
            this.getWiadomosciWarmStartUrl(url)
          );
          this.browser?.executeScript({
            code: `window.location.href = '${resumeUrlEsc}';`,
          });
        };

        if (awaitingLogin) {
          var urlLower = event.url.toLowerCase();
          var synergiaLoggedIn =
            urlLower.includes('synergia.librus.pl/uczen/index') ||
            urlLower.includes('synergia.librus.pl/rodzina/index') ||
            urlLower.includes('synergia.librus.pl/rodzic/') ||
            (urlLower.includes('synergia.librus.pl') &&
              !urlLower.includes('/loguj') &&
              !urlLower.includes('synergia/loguj'));

          /** SynergiaIndex — pewny znak zalogowanej przestrzeni Librusa po SSO. */
          if (synergiaLoggedIn) {
            await completeLoginAndNavigateToSection(
              '✅ Logowanie zakończone, wracam do synchronizowanej sekcji...'
            );
            return;
          }

          /** Po SSO częsty landing: portal …/rodzina# bez skoku na synergia.* (wykluczone ścieżki z „loguj”). */
          let portalRodzicaPoLogowaniu = false;
          try {
            const eu = new URL(event.url);
            const pl = eu.pathname.toLowerCase();
            portalRodzicaPoLogowaniu =
              eu.hostname.includes('portal.librus.pl') &&
              pl.includes('/rodzina') &&
              !pl.includes('loguj');
          } catch {
            portalRodzicaPoLogowaniu = false;
          }

          if (portalRodzicaPoLogowaniu) {
            await completeLoginAndNavigateToSection(
              `✅ Logowanie na Portal rodzina — przechodzę do synchro: ${url.slice(0, 96)}`
            );
            return;
          }

          if (this.scrapeTargetPageReady(probeUrl, url)) {
            devLog(
              '✅ Po logowaniu jesteśmy na docelowej stronie — rozpoczynam scraping.'
            );
            awaitingLogin = false;
            if (loginTimeout) {
              clearTimeout(loginTimeout);
              loginTimeout = null;
            }
            await this.markSessionActive();
            clearSectionTimeout();
            forceScrapeThisStop = true;
          } else {
            devLog('⏳ Nadal czekam na zakończenie logowania...');
            return;
          }
        }

        const shouldScrape =
          forceScrapeThisStop ||
          this.scrapeTargetPageReady(probeUrl, url) ||
          this.isWiadomosciSpaWarmupPage(probeUrl, url);

        if (shouldScrape) {
          clearPortalStuckFallbackTimer();
          if (this.domScrapeRunning) {
            devLog('⏭️ Scraping DOM już trwa — pomijam duplikat loadstop.');
            return;
          }
          this.domScrapeRunning = true;

          devLog(`✅ Na właściwej stronie, wykonuję scraping...`);
          clearSectionTimeout();
          scrapingInProgress = true;
          armScrapeWatchdog();

          try {
            this.domScrapeBeginGateOnce();
            await new Promise(r => setTimeout(r, 2000));

            let currentLocation = await this.readWebViewLocationHref(event.url);

            let sameHost = false;
            try {
              sameHost =
                new URL(currentLocation).hostname === new URL(url).hostname;
            } catch {
              sameHost = false;
            }

            if (
              sameHost &&
              !this.scrapeTargetPageReady(currentLocation, url) &&
              !currentLocation.includes('/loguj') &&
              wrongPathRedirects < 1
            ) {
              wrongPathRedirects += 1;
              devLog(
                '🔁 Inna podstrona w tej samej domenie — ponawiam nawigację do:',
                url
              );
              this.browser?.executeScript({
                code: `window.location.href = '${this.escapeJsSingleQuoted(url)}';`
              });
              scrapingInProgress = false;
              clearScrapeWatchdog();
              startSectionTimeout();
              return;
            }

            if (
              sameHost &&
              !this.scrapeTargetPageReady(currentLocation, url) &&
              !currentLocation.includes('/loguj')
            ) {
              devWarn(
                '⚠️ Ścieżka WebView nadal różni się od oczekiwanej (limit 1 naprawy). Scrapuję mimo to:',
                currentLocation
              );
            }

            const onOtherDomainPortal =
              (() => {
                try {
                  const want = new URL(url);
                  const got = new URL(currentLocation);
                  return (
                    want.hostname !== got.hostname &&
                    got.hostname.indexOf('portal.librus.pl') !== -1
                  );
                } catch {
                  return false;
                }
              })();

            if (
              currentLocation.includes('/session-expired') ||
              currentLocation.includes('/loguj') ||
              onOtherDomainPortal
            ) {
              if (wiadomSkrzynkaBezRelog) {
                finishInboxWiadWithoutRelog(
                  'przed scrapowaniem: /session-expired, /loguj lub portal zamiast skrzynki'
                );
                scrapingInProgress = false;
                clearScrapeWatchdog();
                return;
              }
              await requestManualLogin(
                'Strona docelowa zgłosiła wygasłą sesję!',
                true
              );
              scrapingInProgress = false;
              clearScrapeWatchdog();
              return;
            }

            const diagnostics = await this.browser?.executeScript({
              code: `
                (function() {
                  return JSON.stringify({
                    href: window.location.href,
                    title: document.title,
                    bodyLength: document.body ? document.body.innerText.length : 0,
                    gradeRows: document.querySelectorAll('tr.line0, tr.line1').length,
                    gradeBoxes: document.querySelectorAll('span.grade-box, a.grade-box, .grade-box').length,
                    muiRows: document.querySelectorAll('#contentMain tbody tr, .MuiTableBody-root tr').length,
                    tables: document.querySelectorAll('table').length,
                    sampleText: document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) : ''
                  });
                })();
              `
            });
            const diagObj = this.parseBridgeScriptResult(diagnostics?.[0]);
            devLog('🧪 Diagnostyka strony przed scrapingiem JSON:', JSON.stringify(diagObj));

            const diagRecord =
              diagObj && typeof diagObj === 'object' && !Array.isArray(diagObj)
                ? (diagObj as Record<string, unknown>)
                : null;
            if (this.isWiadomosciSessionExpiredInPage(url, diagRecord)) {
              if (wiadomSkrzynkaBezRelog) {
                finishInboxWiadWithoutRelog(
                  'diagnostyka strony sugeruje wygasłą sesję skrzynki (bez okna logowania)'
                );
                return;
              }
              await requestManualLogin(
                'Wiadomości Librus: sesja na wiadomosci.librus.pl wygasła lub wymaga ponownego logowania. Zaloguj się w oknie — potem ponów Sync.',
                true
              );
              return;
            }

            devLog(
              chunkedGrades
                ? `🔍 Pobieram oceny (chunkowany transport, jak stary kod: span.grade-box a)...`
                : `🔍 Wykonuję skrypt JavaScript...`
            );

            let parsed: unknown;
            if (chunkedGrades) {
              parsed = await this.readGradesJsonChunkedFromBrowser(
                options?.onGradesChunkProgress
              );
            } else {
              const result = await this.browser?.executeScript({ code: script });
              parsed = this.parseBridgeScriptResult(result?.[0]);
            }
            if (chunkedGrades && Array.isArray(parsed)) {
              devLog('📦 Wynik ocen: przedmioty (chunki):', parsed.length);
            } else {
              devLog(
                '📦 Wynik skryptu (skrót):',
                typeof parsed === 'string'
                  ? parsed.slice(0, 400)
                  : JSON.stringify(parsed)?.slice(0, 1200)
              );
            }

            scrapingDone = true;
            scrapingInProgress = false;
            clearScrapeWatchdog();
            clearSectionTimeout();
            detachScrapeListener();

            resolve(parsed ?? null);
          } catch (err) {
            console.error('❌ Błąd scrapingu:', err);
            scrapingDone = true;
            scrapingInProgress = false;
            clearScrapeWatchdog();
            clearSectionTimeout();
            detachScrapeListener();
            resolve(null);
          } finally {
            this.domScrapeRunning = false;
          }
        } else if (event.url.includes('/loguj')) {
          if (wiadomSkrzynkaBezRelog) {
            finishInboxWiadWithoutRelog('loadstop na stronie /loguj podczas scrapingu skrzynki');
            return;
          }
          await requestManualLogin('Wymagane logowanie', false);
        } else if (
          event.url.includes('portal.librus.pl/rodzina') ||
          (event.url.includes('portal.librus.pl') && !event.url.includes('/loguj'))
        ) {
          const SSO_PORTAL_GRACE_MS = 12000;
          const onPortalEarly =
            this.targetUsesPortalSsoHop(url) &&
            Date.now() - sectionNavStartedAt < SSO_PORTAL_GRACE_MS;
          if (onPortalEarly) {
            devLog(
              '⏳ Portal SSO (pośredni) — czekam na docelową domenę:',
              event.url
            );
            armPortalStuckFallbackTimer();
            return;
          }
          if (wiadomSkrzynkaBezRelog) {
            finishInboxWiadWithoutRelog(
              'utknięcie na portalu po oknie tolerancji SSO — pomijam wymuszenie logowania dla skrzynki'
            );
            return;
          }
          await requestManualLogin(
            'Przekierowano na portal (brak dostępu do sekcji) — wymagane ponowne logowanie!',
            true
          );
        }
      };

      subscription = this.browser.on('loadstop').subscribe((event: InAppBrowserEvent) => {
        void processScrapeLoadStop(event);
      });

      this.scrapeLoadStopSub = subscription ?? null;

      if (awaitingLogin) {
        devLog('⏳ Czekam na ręczne logowanie w widocznej przeglądarce...');
        loginTimeout = setTimeout(() => {
          if (awaitingLogin && !scrapingDone) {
            scrapingDone = true;
            scrapingInProgress = false;
            clearScrapeWatchdog();
            detachScrapeListener();
            devLog('⏱️ Timeout logowania ręcznego');
            this.browser?.hide();
            resolve(null);
          }
        }, 120000);
      } else {
        startSectionTimeout();
        /** Po moście SSO WebView bywa już na skrzynce zanim podłączymy loadstop — bez tego brak zdarzenia i sync wisi. */
        if (url.includes('wiadomosci.librus.pl')) {
          const runWiadKick = (delayMs: number, label: string): void => {
            setTimeout(() => {
              void (async () => {
                if (
                  scrapeGen !== this.scrapeGeneration ||
                  scrapingDone ||
                  scrapingInProgress ||
                  awaitingLogin
                ) {
                  return;
                }
                const hrefKick = this.ensureHttpsLibrusUrl(
                  await this.readWebViewLocationHref('')
                );
                if (!hrefKick.includes('wiadomosci.librus.pl')) {
                  devLog(
                    `🔄 Skrzynka: kick ${label} (${delayMs} ms) — jeszcze nie na wiadomosci.pl, pomijam:`,
                    hrefKick.slice(0, 100)
                  );
                  return;
                }
                devLog(
                  `🔄 Skrzynka: kick ${label} (${delayMs} ms) gotowości: ${hrefKick.slice(0, 120)}`
                );
                await processScrapeLoadStop({ url: hrefKick } as InAppBrowserEvent);
              })();
            }, delayMs);
          };
          runWiadKick(400, 'wczesny');
          runWiadKick(1600, 'średni');
          runWiadKick(4000, 'późny');
        }
      }
    });
  }

  async pobierzOcenyHybrydowo(): Promise<any> {
    const hasValidSession = await this.checkSessionValid();
    
    return new Promise((resolve, reject) => {

      devLog('=== ROZPOCZYNAM SESJĘ ===');
      devLog('Czy mam zapisaną sesję?', hasValidSession);
      
      if (!this.browser) {
        const options = hasValidSession 
          ? 'location=no,hidden=yes,clearcache=no,clearsessioncache=no,cleardata=no'
          : 'location=yes,hidden=no,clearcache=no,clearsessioncache=no,cleardata=no';
        
        this.browser = this.iab.create(
          'https://synergia.librus.pl/przegladaj_oceny/uczen',
          '_blank',
          options
        );

        if (hasValidSession) {
          devLog('✅ Używam zapisanej sesji - okno ukryte.');
        } else {
          devLog('❌ Brak sesji - wymagane logowanie ręczne.');
        }
      } else {
        devLog('🔄 Przegląarka już istnieje, nawiguję do strony ocen...');
        this.browser.executeScript({ code: "window.location.href = 'https://synergia.librus.pl/przegladaj_oceny/uczen';" });
      }

      let scrapingStarted = false;

      // Reagujemy na każde przeładowanie
      this.browser.on('loadstop').subscribe(async (event: InAppBrowserEvent) => {
        devLog('📍 Adres URL:', event.url);

        this.syncDemoRecordingBlurForWebView(event.url);

        // --- ZABÓJCA OVERLAYÓW (RODO/Cookies) ---
        this.browser?.insertCSS({
          code: '#cookieBox, .cookieBox, #cookie-warn, .overlay { display: none !important; } body { overflow: auto !important; }'
        });
        this.browser?.executeScript({
          code: "var cb = document.getElementById('cookieBox'); if(cb) cb.remove();"
        });

        // --- LOGIKA SESJI ---

        // STAN 1: Jesteśmy u celu (Oceny)
        if (event.url.includes('przegladaj_oceny/uczen')) {
          this.browser?.hide();

          if (!scrapingStarted) {
            scrapingStarted = true;
            devLog('✅ Mamy sesję! Scrapowanie danych...');

            try {
              const raw = await this.readGradesJsonChunkedFromBrowser();
              const wynik = Array.isArray(raw) ? raw : [];
              devLog('✅ Sukces! Zapisuję marker sesji.');
              
              // Zapisujemy marker że sesja jest aktywna (ale NIE cookies, bo są HttpOnly)
              await this.markSessionActive();
              
              this.browser?.hide();
              scrapingStarted = false;
              resolve(wynik);
            } catch (err) {
              console.error('❌ Błąd scrapowania:', err);
              reject('Błąd odczytu danych.');
            }
          }
        }
        // STAN 2: Zalogowano, przekierowanie na dashboard
        else if (event.url.includes('synergia.librus.pl/uczen/index') || event.url.includes('synergia.librus.pl/rodzina/index')) {
           devLog('✅ Zalogowano pomyślnie, zapisuję marker sesji...');
           await this.markSessionActive();
           this.browser?.hide();
           this.browser?.executeScript({ code: "window.location.href = 'https://synergia.librus.pl/przegladaj_oceny/uczen';" });
        }
        // STAN 3: Wyrzuciło nas do logowania lub landing page (brak sesji)
        else if (event.url.includes('portal.librus.pl/rodzina/synergia/loguj') || event.url.includes('/loguj')) {
           devLog('⚠️ Przekierowano do logowania - sesja wygasła po stronie serwera.');
           devLog('🧹 Czyszczę marker sesji...');
           await this.clearSession();
           devLog('👤 Wymagane ponowne logowanie ręczne.');
           this.browser?.show();
           scrapingStarted = false;
        }
        // STAN 4: Portal landing (możliwa wygasła sesja)
        else if (event.url.includes('portal.librus.pl') && !event.url.includes('/loguj')) {
           devLog('⚠️ Portal landing page - prawdopodobnie sesja wygasła.');
           devLog('Pokazuję okno, możesz kliknąć "Zaloguj przez Synergia"');
           this.browser?.show();
           scrapingStarted = false;
        }
      });

      // Obsługa zamknięcia przeglądarki
      this.browser.on('exit').subscribe(() => {
        devLog('⚠️ Przeglądarka została zamknięta przez użytkownika.');
        this.clearDemoIabBlurRetries();
        this.browser = null;
        // Sesja zostanie wyczyszczona tylko przy:
        // 1. Manualnym wylogowaniu (forceLogout)
        // 2. Przekierowaniu do logowania (expired session)
        reject('Przeglądarka została zamknięta.');
      });

    });
  }

  /**
   * Test po Sync: otwiera dashboard rodzica **w IAB** (sesja + HttpOnly są w tym WebView;
   * `CapacitorCookies` dla synergia jest zwykle puste po samym scrapowaniu z wiadomości).
   * Nawigacja `rodzic/index` → `loadstop` → odczyt treści strony. Wywołuj przed `closeInAppBrowserAfterSync`.
   */
  private async runDeferredHttpPingAfterSync(): Promise<void> {
    const tag = '[HTTP-AFTER-SYNC]';
    const targetUrl = this.LIBR_SYNERGIA_RODZIC_DASHBOARD_URL;
    const targetEsc = this.escapeJsSingleQuoted(targetUrl);

    if (this.browser) {
      try {
        console.log(tag, 'IAB navigate →', targetUrl);
        const loadDone = firstValueFrom(
          this.browser.on('loadstop').pipe(
            filter((e: InAppBrowserEvent) => {
              const u = (e.url || '').toLowerCase();
              return u.includes('synergia.librus.pl') && u.includes('rodzic');
            }),
            take(1),
            timeout({ first: 25_000 })
          )
        );
        await this.browser.executeScript({
          code: `window.location.href = '${targetEsc}';`,
        });

        const ev = await loadDone;
        console.log(tag, 'loadstop URL:', ev.url);

        const docCookieCode = `(function(){ try { return document.cookie || ''; } catch (e) { return ''; } })();`;
        const docRaw = await this.browser.executeScript({ code: docCookieCode });
        const docStr = docRaw?.[0] != null ? String(docRaw[0]) : '';
        const fromDoc = this.parseBrowserCookieString(docStr);

        let merged = await this.mergeCapacitorJarsForRodzic();
        for (const [k, v] of Object.entries(fromDoc)) {
          if (merged[k] == null || merged[k] === '') {
            merged[k] = v;
          }
        }

        const cookieHeader = this.buildRodzicCapacitorHttpCookieHeader(merged);
        const presentKeys = this.rodzicCookieHeaderKeyOrder.filter(
          (k) => merged[k] != null && String(merged[k]).length > 0
        );
        console.log(
          tag,
          'Cookie header length:',
          cookieHeader.length,
          '| keys present (unordered scan):',
          presentKeys.join(', ')
        );
        console.log(tag, 'Cookie header:', cookieHeader);

        if (
          !cookieHeader.includes('cookiesession1=') ||
          !cookieHeader.includes('DZIENNIKSID=')
        ) {
          console.log(
            tag,
            'warning: missing cookiesession1 and/or DZIENNIKSID — CapacitorHttp GET may return login page.'
          );
        }

        try {
          const httpRes = await CapacitorHttp.get({
            url: targetUrl,
            headers: {
              Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
              Cookie: cookieHeader,
            },
          });
          console.log(tag, 'CapacitorHttp GET status:', httpRes.status);
          const hd = httpRes.data;
          const httpPreview =
            typeof hd === 'string'
              ? hd.slice(0, 2500)
              : hd != null
                ? JSON.stringify(hd).slice(0, 2500)
                : '(empty)';
          console.log(
            tag,
            'CapacitorHttp response HTML preview (first ~2500 chars — this IS raw server HTML):',
            httpPreview
          );
        } catch (httpErr) {
          console.log(tag, 'CapacitorHttp GET error:', String(httpErr));
        }

        const readCode = `(function(){
          try {
            var html = '';
            var htmlFrom = '';
            try {
              var banner = document.getElementById('top-banner-container');
              if (banner) {
                html = String(banner.outerHTML || '');
                htmlFrom = 'top-banner-container';
              } else {
                html = (document.body && document.body.innerHTML) ? String(document.body.innerHTML) : '';
                htmlFrom = 'body-innerHTML-fallback';
              }
            } catch (_) {}
            return JSON.stringify({
              via: 'IAB-DOM-after-rodzic-nav',
              href: String(location.href || ''),
              title: String(document.title || ''),
              snip: String((document.body && document.body.innerText) ? document.body.innerText : '').slice(0, 900),
              htmlSnipFrom: htmlFrom,
              htmlSnip: html.slice(0, 12000)
            });
          } catch (e) {
            return JSON.stringify({ via: 'IAB-DOM', err: String(e && e.message != null ? e.message : e) });
          }
        })();`;

        const raw = await this.browser.executeScript({ code: readCode });
        const txt =
          raw != null && raw[0] != null && raw[0] !== ''
            ? String(raw[0])
            : '(empty executeScript result)';
        console.log(tag, 'page snapshot (raw):', txt);
        try {
          const parsed = JSON.parse(txt) as {
            href?: string;
            title?: string;
            snip?: string;
            htmlSnip?: string;
            htmlSnipFrom?: string;
            err?: string;
          };
          if (parsed.err) {
            console.log(tag, 'DOM read error:', parsed.err);
          } else {
            console.log(tag, 'final href:', parsed.href);
            console.log(tag, 'document.title:', parsed.title);
            if (parsed.htmlSnipFrom) {
              console.log(tag, 'HTML snippet source:', parsed.htmlSnipFrom);
            }
            if (parsed.snip) {
              console.log(
                tag,
                'body innerText preview (no HTML tags):',
                parsed.snip
              );
            }
            if (parsed.htmlSnip) {
              console.log(
                tag,
                'HTML snippet (#top-banner-container outerHTML when present, else body):',
                parsed.htmlSnip
              );
            }
          }
        } catch {
          console.log(tag, 'could not JSON.parse snapshot');
        }
      } catch (e) {
        console.log(tag, 'nav / loadstop / snapshot failed:', String(e));
      }
      return;
    }

    console.log(
      tag,
      'no InAppBrowser handle — trying CapacitorHttp + CapacitorCookies (may be empty)…'
    );

    try {
      if (!Capacitor.isNativePlatform()) {
        console.log(
          tag,
          'Skipped: not native — no IAB and no Capacitor cookie jar for this test.'
        );
        return;
      }
      const merged = await this.mergeCapacitorJarsForRodzic();
      const cookieHeader = this.buildRodzicCapacitorHttpCookieHeader(merged).trim();
      if (!cookieHeader) {
        console.log(
          tag,
          'Empty Cookie header after merge — IAB was already closed; no session in native jars.'
        );
        return;
      }
      console.log(tag, 'Cookie header:', cookieHeader);
      console.log(tag, 'GET', targetUrl, '| Cookie header length:', cookieHeader.length);
      const res = await CapacitorHttp.get({
        url: targetUrl,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          Cookie: cookieHeader,
        },
      });
      console.log(tag, 'response.status', res.status);
      console.log(
        tag,
        'response.headers',
        typeof res.headers === 'object'
          ? JSON.stringify(res.headers)
          : res.headers
      );
      const body = res.data;
      const preview =
        typeof body === 'string'
          ? body.slice(0, 900)
          : body != null
            ? JSON.stringify(body).slice(0, 900)
            : '(empty)';
      console.log(tag, 'response.data preview:', preview);
    } catch (e) {
      console.log(tag, 'CapacitorHttp error', e);
    }
  }

  // Zamiast próbować kopiować HttpOnly cookies, po prostu zapisujemy marker że sesja jest aktywna
  async markSessionActive(): Promise<void> {
    try {
      const sessionData = {
        active: true,
        timestamp: Date.now(),
        expiresAt: Date.now() + this.SESSION_DURATION
      };

      await Preferences.set({
        key: this.COOKIE_STORAGE_KEY,
        value: JSON.stringify(sessionData)
      });

      devLog('✅ Marker sesji zapisany.');
    } catch (error) {
      console.error('❌ Błąd zapisywania markera sesji:', error);
    }
  }
}
