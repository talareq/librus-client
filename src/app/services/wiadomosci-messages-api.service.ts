import { Injectable } from '@angular/core';
import { Capacitor, CapacitorCookies, CapacitorHttp } from '@capacitor/core';
import { devLog, devWarn } from '../utils/dev-log';

/**
 * Pobiera listę wiadomości z REST API skrzynki (to samo co XHR w InAppBrowser),
 * Na urządzeniu żądanie ustawia `Cookie` dokładnie tak jak przeglądarka dla
 * tej hosta: łańcuch `klucz=wartość; klucz=wartość` (np. `cookiesession1=…; DZIENNIKSID=Axx~…`)
 * ze wszystkich pozycji zwróconych przez `CapacitorCookies.getCookies({ url: 'https://wiadomosci.librus.pl' })`.
 * na `ng serve` przez proxy `/lw-msg` (LIBRU_WIAD_COOKIE w env proxy).
 */
@Injectable({
  providedIn: 'root',
})
export class WiadomosciMessagesApiService {
  private clean(text: unknown): string {
    return String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeB64Utf8(b64: string): string {
    if (!b64 || typeof b64 !== 'string') {
      return '';
    }
    try {
      const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
      const n = bin.length;
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        bytes[i] = bin.charCodeAt(i) & 0xff;
      }
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  }

  private fmtPl(fromIso: string): string {
    if (!fromIso) {
      return '';
    }
    const d = new Date(fromIso);
    if (isNaN(d.getTime())) {
      return fromIso;
    }
    try {
      return d.toLocaleString('pl-PL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return fromIso.slice(0, 16).replace('T', ' ');
    }
  }

  private mapApiRowToScraperItem(m: Record<string, unknown>): Record<string, unknown> | null {
    if (m['messageId'] == null) {
      return null;
    }
    const iso = typeof m['sendDate'] === 'string' ? (m['sendDate'] as string) : '';
    const bodyText = this.decodeB64Utf8(
      typeof m['content'] === 'string' ? (m['content'] as string) : ''
    );
    return {
      id: String(m['messageId']),
      sender: this.clean(m['senderName'] ?? ''),
      subject: this.clean(m['topic'] ?? ''),
      date: this.fmtPl(iso),
      sendDateIso: iso,
      isRead: Boolean(m['readDate']),
      hasAttachment: Boolean(m['isAnyFileAttached']),
      body: bodyText,
    };
  }

  private normalizePayload(data: unknown): unknown {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as unknown;
      } catch {
        return false;
      }
    }
    return data;
  }

  private parseInboxResponseBody(data: unknown): {
    rows: Record<string, unknown>[];
    total: number;
  } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const o = data as Record<string, unknown>;
    const arr = o['data'];
    if (!Array.isArray(arr)) {
      return null;
    }
    const total =
      typeof o['total'] === 'number' && Number.isFinite(o['total'])
        ? (o['total'] as number)
        : arr.length;
    const rows: Record<string, unknown>[] = [];
    for (const item of arr) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        rows.push(item as Record<string, unknown>);
      }
    }
    return { rows, total };
  }

  private async wiadomosciCookieJar(): Promise<Record<string, string>> {
    try {
      return await CapacitorCookies.getCookies({
        url: 'https://wiadomosci.librus.pl',
      });
    } catch {
      return {};
    }
  }

  /**
   * InAppBrowser (Cordova) trzyma ciastka w innym WebView niż główny Capacitor —
   * wtedy getCookies() jest puste i natywny REST i tak nie zadziała.
   */
  private nativeJarLooksLikeWiadomosciSession(jar: Record<string, string>): boolean {
    const keys = Object.keys(jar);
    if (keys.length === 0) {
      return false;
    }
    return keys.some(
      k =>
        /^DZIENNIKSID$/i.test(k) ||
        /session/i.test(k) ||
        /sid/i.test(k)
    );
  }

  private cookieHeaderFromJar(jar: Record<string, string>): string {
    return Object.entries(jar)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('; ');
  }

  private async fetchMessagesPage(
    page: number,
    limit: number,
    nativeCookieJar: Record<string, string>
  ): Promise<unknown> {
    if (Capacitor.isNativePlatform()) {
      const cookie = this.cookieHeaderFromJar(nativeCookieJar);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (cookie.trim().length > 0) {
        headers['Cookie'] = cookie;
        if (page === 1) {
          devLog(
            `📬 REST api/inbox/messages — nagłówek Cookie z magazynu wiadomosci.librus.pl (${cookie.length} zn.):`,
            cookie
          );
        }
      }
      const resp = await CapacitorHttp.get({
        url: 'https://wiadomosci.librus.pl/api/inbox/messages',
        params: {
          page: String(page),
          limit: String(limit),
        },
        headers,
      });
      if (!(resp.status >= 200 && resp.status < 300)) {
        return false;
      }
      const payload = this.normalizePayload(resp.data);
      return payload === false ? false : payload;
    }

    /** Web (`ng serve`): proxy dodaje Cookie — patrz proxy.conf.js */
    try {
      const q = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`/lw-msg?${q.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return false;
      }
      return await res.json();
    } catch {
      return false;
    }
  }

  /**
   * Kształt jak lista z inject w InAppBrowser (do parseMessages).
   * null = nie udało się pobrać (brak sesji dev / native cookie / HTTP).
   */
  async tryFetchAllInboxMessagesMappedToScraperShape(): Promise<any[] | null> {
    const limit = 50;
    let page = 1;
    const all: any[] = [];
    let total = Infinity;
    let safety = 0;

    let nativeJar: Record<string, string> = {};
    if (Capacitor.isNativePlatform()) {
      nativeJar = await this.wiadomosciCookieJar();
      if (!this.nativeJarLooksLikeWiadomosciSession(nativeJar)) {
        const keys = Object.keys(nativeJar).sort();
        devLog(
          '📬 Pomijam natywny REST wiadomości — stąd brak linii „REST api/inbox … Cookie”. ' +
            'Magazyn Capacitor `wiadomosci.librus.pl`: ' +
            (keys.length === 0 ? '(pusto)' : keys.join(', ')) +
            '. (Żądanie HTTP z Cookie wykona się dopiero po skopiowaniu sesji do tego słoika lub ręcznie w dev proxy.)'
        );
        return null;
      }
    }

    while (all.length < total && safety < 120) {
      safety++;
      const raw = await this.fetchMessagesPage(page, limit, nativeJar);

      if (raw === false) {
        devWarn(
          '⚠️ Wiadomości API: żądanie HTTP nieudane mimo ciastek (wygasła sesja / sieć) — użyty zostanie InAppBrowser.'
        );
        return null;
      }

      const parsed = this.parseInboxResponseBody(raw);
      if (!parsed) {
        devWarn('⚠️ Wiadomości API: odpowiedź nie wygląda jak JSON inboxu');
        return null;
      }

      if (parsed.rows.length === 0) {
        break;
      }

      total = parsed.total;

      for (const row of parsed.rows) {
        const item = this.mapApiRowToScraperItem(row);
        if (item) {
          all.push(item);
        }
      }

      if (all.length >= total) {
        break;
      }
      if (parsed.rows.length < limit) {
        break;
      }
      page += 1;
    }

    return all;
  }
}
