export const environment = {
  production: true,
  /**
   * Po Sync: opóźniony GET (CapacitorHttp) — logi `[HTTP-AFTER-SYNC]` w logcat.
   * Ustaw na `false` przed wydaniem do sklepu, jeśli nie chcesz tego w releasie.
   */
  simulateDeferredHttpAfterSync: true,
  /**
   * Lokalna notyfikacja po Sync. Ustaw na `false` przed wydaniem do sklepu,
   * jeśli nie chcesz powiadomień po każdej synchronizacji.
   */
  localNotifyOnSyncSuccess: true,
  /** Lokalne codzienne przypomnienie o sync (bez backendu). Wyłącz przed wydaniem, jeśli ma nie wysyłać. */
  scheduledOpenAppReminder: {
    enabled: true,
    hour: 8,
    minute: 0,
  },
  /** FCM wake — ustaw URL + token po wdrożeniu `backend/`; domyślnie wyłączone. */
  remotePushWake: {
    enabled: false,
    apiBaseUrl: '',
    apiBearerToken: '523c0d461804d4ac5295e9d69d56b54d170fc5ff62dc5d556a4374d7f527fc42',
  },
  /**
   * Na nagranie używaj osobnego buildu: `npm run build:demo` (`environment.demo.ts`).
   * Tu zostaw `false`, żeby zwykły release APK nie miał trybu „demo”.
   */
  demoRecordingPrivacy: false,
  versionCheck: {
    enabled: true,
    packageJsonUrl:
      'https://raw.githubusercontent.com/talareq/librus-client/main/package.json',
    repositoryPageUrl: 'https://github.com/talareq/librus-client/actions'
  }
};
