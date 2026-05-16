import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications, type ActionPerformed } from '@capacitor/local-notifications';
import { Subject } from 'rxjs';
import {
  LOCAL_NOTIFY_EXTRA_KIND,
  type LibrusLocalNotificationExtraPayload,
} from '../utils/sync-local-notification';

/**
 * Obsługa tapnięcia lokalnej notyfikacji: nawigacja na /home i opcjonalnie sygnał do auto-sync.
 * Rejestracja jak najwcześniej (APP_INITIALIZER), żeby nie zgubić zdarzenia przy starcie z killed.
 */
@Injectable({ providedIn: 'root' })
export class LocalNotificationTapService {
  private handle: PluginListenerHandle | null = null;

  /** Wyemitowane po wejściu na home z notyfikacji z `startSync: true` (kolejka na następny tick po navigate). */
  readonly afterReminderOpenRequestSync$ = new Subject<void>();

  constructor(
    private readonly router: Router,
    private readonly ngZone: NgZone
  ) {}

  async registerTapListener(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    if (this.handle) {
      return;
    }
    this.handle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action: ActionPerformed) => {
        void this.onNotificationTapped(action);
      }
    );
  }

  private async onNotificationTapped(action: ActionPerformed): Promise<void> {
    const extra = action.notification.extra as LibrusLocalNotificationExtraPayload | undefined;
    if (extra?.kind !== LOCAL_NOTIFY_EXTRA_KIND) {
      return;
    }
    const requestSync = extra.startSync === true;
    await this.ngZone.run(async () => {
      await this.router.navigate(['/home'], { replaceUrl: false });
    });
    if (requestSync) {
      this.ngZone.run(() => {
        setTimeout(() => this.afterReminderOpenRequestSync$.next(), 0);
      });
    }
  }
}
