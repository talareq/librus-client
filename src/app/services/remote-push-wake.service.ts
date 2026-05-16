import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { LibrusAuthService } from './librus-auth';
import { devLog } from '../utils/dev-log';

/**
 * Wartość pola `data.action` w komunikacie FCM wysyłanym przez backend (`/v1/wake`).
 * Backend nie przesyła ciasteczek Librus — tylko ten znacznik; sync leci wyłącznie na urządzeniu.
 */
export const REMOTE_PUSH_WAKE_ACTION = 'librus_wake_sync';

@Injectable({ providedIn: 'root' })
export class RemotePushWakeService {
  private initialized = false;
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
    this.initialized = true;

    await this.attachListeners(base, bearer);

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      console.warn('[RemotePushWake] Brak zgody na push:', perm.receive);
      return;
    }

    try {
      await PushNotifications.register();
    } catch (e) {
      console.warn('[RemotePushWake] register() nie powiodło się — sprawdź Firebase (google-services.json / iOS).', e);
    }
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

    const onData = (data: Record<string, unknown> | undefined) => {
      const action = data && typeof data['action'] === 'string' ? data['action'] : undefined;
      if (action !== REMOTE_PUSH_WAKE_ACTION) {
        return;
      }
      void this.runWakeSyncFromFcm();
    };

    this.handles.push(
      await PushNotifications.addListener('pushNotificationReceived', (n) => {
        this.ngZone.run(() => onData(n.data));
      })
    );

    this.handles.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (e) => {
        this.ngZone.run(() => onData(e.notification?.data));
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
