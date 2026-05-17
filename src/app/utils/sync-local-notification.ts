import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { environment } from '../../environments/environment';

const SYNC_CHANNEL_ID = 'librus_sync';
const REMINDER_CHANNEL_ID = 'librus_reminder';
const APP_UPDATES_CHANNEL_ID = 'librus_app_updates';
/** Stałe ID — anuluj przed ponownym `schedule`, żeby nie duplikować. */
export const OPEN_APP_SYNC_REMINDER_NOTIFICATION_ID = 92_001;
const NEW_RELEASE_LOCAL_NOTIFICATION_ID = 92_003;

/**
 * `extra.kind` musi się zgadzać z obsługą w `LocalNotificationTapService`
 * (`localNotificationActionPerformed`).
 */
export const LOCAL_NOTIFY_EXTRA_KIND = 'librus_client_open_home' as const;

/** Tap → otwórz URL (np. strona release z APK) w przeglądarce systemowej. */
export const LOCAL_NOTIFY_RELEASE_EXTRA_KIND = 'librus_client_open_release' as const;

export type LibrusLocalNotificationExtraPayload = {
  kind: typeof LOCAL_NOTIFY_EXTRA_KIND;
  /** Po tapnięciu: po wejściu na Home uruchom sync (tylko przy sesji). */
  startSync?: boolean;
};

export type LibrusLocalNotificationReleaseExtraPayload = {
  kind: typeof LOCAL_NOTIFY_RELEASE_EXTRA_KIND;
  openUrl: string;
};

export type LibrusLocalNotificationAnyExtra =
  | LibrusLocalNotificationExtraPayload
  | LibrusLocalNotificationReleaseExtraPayload;

/**
 * Wyciąga liczby z `<span class="circle">…</span>` w HTML `#top-banner-container` / `#graphic-menu`.
 * Gdy Librus wstawia badge — zwykle cyfry są wewnątrz spanu. Puste circle = brak wpisu.
 * Docelowo: porównanie z poprzednim snapshotem → lokalna notyfikacja „jest coś nowego”.
 */
export function extractCircleBadgeCountsFromGraphicMenuHtml(html: string): number[] {
  const out: number[] = [];
  const re = /<span[^>]*class="[^"]*\bcircle\b[^"]*"[^>]*>([^<]*)<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (/^\d+$/.test(raw)) {
      out.push(parseInt(raw, 10));
    }
  }
  return out;
}

/**
 * Lokalna notyfikacja po FCM `librus_new_version` (link z GitHub Release).
 * Nie wymaga sesji Librus — tylko zgody na powiadomienia.
 */
export async function notifyNewReleaseFromFcm(tag: string, releaseUrl: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  const t = tag.trim() || 'nowa wersja';
  const url = releaseUrl.trim();
  if (!url) {
    return;
  }
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      console.warn(
        '[LocalNotify] notifyNewReleaseFromFcm: brak zgody display (ustawienia powiadomień aplikacji):',
        perm.display
      );
      return;
    }
    if (Capacitor.getPlatform() === 'android') {
      await LocalNotifications.createChannel({
        id: APP_UPDATES_CHANNEL_ID,
        name: 'Aktualizacje',
        description: 'Informacje o nowej wersji aplikacji',
        importance: 5,
        vibration: true,
      });
    }
    await LocalNotifications.cancel({
      notifications: [{ id: NEW_RELEASE_LOCAL_NOTIFICATION_ID }],
    });
    const extra: LibrusLocalNotificationReleaseExtraPayload = {
      kind: LOCAL_NOTIFY_RELEASE_EXTRA_KIND,
      openUrl: url,
    };
    const n: LocalNotificationSchema = {
      title: 'Librus Client',
      body: `Dostępna wersja ${t}. Dotknij, aby pobrać APK.`,
      id: NEW_RELEASE_LOCAL_NOTIFICATION_ID,
      channelId: APP_UPDATES_CHANNEL_ID,
      schedule: { at: new Date(Date.now() + 150) },
      extra,
      autoCancel: true,
    };
    if (Capacitor.getPlatform() === 'ios') {
      n.interruptionLevel = 'active';
    }
    await LocalNotifications.schedule({ notifications: [n] });
  } catch (e) {
    console.warn('[LocalNotify] notifyNewReleaseFromFcm:', e);
  }
}

/**
 * Test: lokalne powiadomienie po udanym Sync (nie wymaga serwera).
 * Wymaga zgody użytkownika (Android 13+ POST_NOTIFICATIONS) i `@capacitor/local-notifications`.
 */
export async function notifyLocalSyncCompletedForTest(): Promise<void> {
  if (!environment.localNotifyOnSyncSuccess) {
    console.log('[LocalNotify] skipped: localNotifyOnSyncSuccess is false (e.g. production env)');
    return;
  }
  if (!Capacitor.isNativePlatform()) {
    console.log('[LocalNotify] skipped: not running on native Capacitor shell');
    return;
  }
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      console.log('[LocalNotify] notifications not granted:', perm.display);
      return;
    }

    if (Capacitor.getPlatform() === 'android') {
      await LocalNotifications.createChannel({
        id: SYNC_CHANNEL_ID,
        name: 'Synchronizacja',
        description: 'Powiadomienia testowe po synchronizacji Librus',
        importance: 4,
        vibration: true,
      });
    }

    const id = Math.floor(Date.now() % 2147483640);
    const extra: LibrusLocalNotificationExtraPayload = {
      kind: LOCAL_NOTIFY_EXTRA_KIND,
      startSync: false,
    };
    await LocalNotifications.schedule({
      notifications: [
        {
          title: 'Librus Client',
          body: 'Synchronizacja zakończona. (test)',
          id,
          channelId: SYNC_CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 400) },
          extra,
          autoCancel: true,
        },
      ],
    });
    console.log('[LocalNotify] scheduled test notification id=', id);
  } catch (e) {
    console.log('[LocalNotify] error', e);
  }
}

/**
 * Codzienne **lokalne** przypomnienie: „otwórz apkę i zrób sync”.
 * Nie jest to zdalny push — harmonogram zapisuje OS po uruchomieniu aplikacji.
 * Bez wysyłania ciasteczek Librus na żaden serwer.
 */
export async function ensureScheduledOpenAppReminder(): Promise<void> {
  const cfg = environment.scheduledOpenAppReminder;
  if (!cfg?.enabled) {
    console.log('[LocalNotify] reminder skipped: scheduledOpenAppReminder.enabled is false');
    return;
  }
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      console.log('[LocalNotify] reminder not scheduled — notifications not granted:', perm.display);
      return;
    }

    if (Capacitor.getPlatform() === 'android') {
      await LocalNotifications.createChannel({
        id: REMINDER_CHANNEL_ID,
        name: 'Przypomnienia',
        description: 'Przypomnienia o synchronizacji z Librusem',
        importance: 3,
        vibration: false,
      });
    }

    await LocalNotifications.cancel({
      notifications: [{ id: OPEN_APP_SYNC_REMINDER_NOTIFICATION_ID }],
    });

    const extra: LibrusLocalNotificationExtraPayload = {
      kind: LOCAL_NOTIFY_EXTRA_KIND,
      startSync: true,
    };
    await LocalNotifications.schedule({
      notifications: [
        {
          id: OPEN_APP_SYNC_REMINDER_NOTIFICATION_ID,
          title: 'Librus Client',
          body: 'Otwórz aplikację i zsynchronizuj dane z Librusem.',
          channelId: REMINDER_CHANNEL_ID,
          schedule: {
            on: {
              hour: cfg.hour,
              minute: cfg.minute,
            },
            every: 'day',
            allowWhileIdle: true,
          },
          extra,
          autoCancel: true,
        },
      ],
    });
    console.log(
      '[LocalNotify] scheduled daily open-app reminder at local',
      `${cfg.hour}:${String(cfg.minute).padStart(2, '0')}`,
    );
  } catch (e) {
    console.log('[LocalNotify] reminder schedule error', e);
  }
}
