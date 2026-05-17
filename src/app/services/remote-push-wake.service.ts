import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { LibrusAuthService } from './librus-auth';
import { devLog } from '../utils/dev-log';
import { notifyNewReleaseFromFcm } from '../utils/sync-local-notification';

/**
 * Wartość pola `data.action` w komunikacie FCM wysyłanym przez backend (`/v1/wake`).
 * Backend nie przesyła ciasteczek Librus — tylko ten znacznik; sync leci wyłącznie na urządzeniu.
 */
export const REMOTE_PUSH_WAKE_ACTION = 'librus_wake_sync';

/** FCM z `POST /v1/notify-version` — informacja o nowym release (bez sync Librus). */
export const REMOTE_PUSH_NEW_VERSION_ACTION = 'librus_new_version';

@Injectable({ providedIn: 'root' })
export class RemotePushWakeService {
  private initialized = false;
  /** Zapobiega wielokrotnemu `addListener` przy ponownym `initialize()`. */
  private listenersAttached = false;
  private handles: PluginListenerHandle[] = [];

  constructor(
    private readonly http: HttpClient,
    private readonly auth: LibrusAuthService,
    private readonly ngZone: NgZone
  ) {}

  /**
   * Rejestracja nasłuchu FCM + wysłanie tokena do małego API (tylko gdy `environment.remotePushWake.enabled`).
   */
  async initialize(): Promise<void> {
    const cfg = environment.remotePushWake;
    if (!cfg?.enabled || !Capacitor.isNativePlatform()) {
      return;
    }
    const base = cfg.apiBaseUrl?.replace(/\/$/, '') ?? '';
    const bearer = cfg.apiBearerToken?.trim() ?? '';
    if (!base || !bearer) {
      console.warn('[RemotePushWake] Uzupełnij remotePushWake.apiBaseUrl i apiBearerToken w environment.');
      return;
    }
    if (this.initialized) {
      return;
    }

    // Kolejność jak w dokumentacji Capacitor: najpierw zgoda, potem listenery, na końcu register().
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      console.warn('[RemotePushWake] Brak zgody na push:', perm.receive);
      return;
    }

    try {
      const localPerm = await LocalNotifications.requestPermissions();
      if (localPerm.display !== 'granted') {
        console.warn(
          '[RemotePushWake] LocalNotifications (banner „nowa wersja”) bez zgody display:',
          localPerm.display
        );
      }
    } catch (e) {
      console.warn('[RemotePushWake] LocalNotifications.requestPermissions:', e);
    }

    if (!this.listenersAttached) {
      await this.attachListeners(base, bearer);
      this.listenersAttached = true;
    }

    try {
      await PushNotifications.register();
    } catch (e) {
      console.warn('[RemotePushWake] register() nie powiodło się — sprawdź Firebase (google-services.json / iOS).', e);
      return;
    }

    this.initialized = true;
  }

  private async attachListeners(apiBase: string, bearer: string): Promise<void> {
    const postToken = async (token: string) => {
      const url = `${apiBase}/v1/devices`;
      try {
        await firstValueFrom(
          this.http.post(
            url,
            { token, platform: Capacitor.getPlatform() },
            { headers: { Authorization: `Bearer ${bearer}` } }
          )
        );
        devLog('[RemotePushWake] Zarejestrowano token FCM u backendu.');
      } catch (e) {
        console.warn('[RemotePushWake] POST /v1/devices nie powiodło się:', e);
      }
    };

    this.handles.push(
      await PushNotifications.addListener('registration', (t) => {
        void postToken(t.value);
      })
    );

    this.handles.push(
      await PushNotifications.addListener('registrationError', (err) => {
        console.warn('[RemotePushWake] registrationError:', err.error);
      })
    );

    const normalizeData = (raw: unknown): Record<string, unknown> | undefined => {
      if (!raw || typeof raw !== 'object') {
        return undefined;
      }
      const d = raw as Record<string, unknown>;
      const inner = d['data'];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
      return d;
    };

    const onData = (data: Record<string, unknown> | undefined) => {
      const action = data && typeof data['action'] === 'string' ? data['action'] : undefined;
      if (action === REMOTE_PUSH_NEW_VERSION_ACTION) {
        const tag = data && typeof data['tag'] === 'string' ? data['tag'].trim() : '';
        const releaseUrl =
          data && typeof data['releaseUrl'] === 'string' ? data['releaseUrl'].trim() : '';
        if (tag && releaseUrl) {
          void notifyNewReleaseFromFcm(tag, releaseUrl);
        } else {
          console.warn('[RemotePushWake] librus_new_version bez tag/releaseUrl:', { tag, releaseUrl });
        }
        return;
      }
      if (action !== REMOTE_PUSH_WAKE_ACTION) {
        if (action) {
          console.warn('[RemotePushWake] nieobsługiwane data.action:', action);
        }
        return;
      }
      void this.runWakeSyncFromFcm();
    };

    this.handles.push(
      await PushNotifications.addListener('pushNotificationReceived', (n) => {
        this.ngZone.run(() => onData(normalizeData(n)));
      })
    );

    this.handles.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (e) => {
        this.ngZone.run(() => onData(normalizeData(e.notification)));
      })
    );
  }

  private async runWakeSyncFromFcm(): Promise<void> {
    const hasSession = await this.auth.checkSessionValid();
    if (!hasSession) {
      devLog('[RemotePushWake] FCM wake: brak sesji — pomijam sync (użytkownik musi się zalogować w aplikacji).');
      return;
    }
    devLog('[RemotePushWake] FCM wake: uruchamiam syncAllData (tylko na urządzeniu).');
    const result = await this.auth.syncAllData({});
    if (!result.success) {
      devLog('[RemotePushWake] sync z FCM nieudany:', result.error ?? 'unknown');
    }
  }
}
