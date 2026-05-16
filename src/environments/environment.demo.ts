/**
 * Build pod nagranie demo / screen recording (prywatność w IAB + redakcja UI).
 *
 * Z Androidem ZAWSZE po web buildzie: `npx cap sync android` (albo `ionic cap sync`)
 * — inaczej w APK zostaje stary `www/` i `demoRecordingPrivacy` nie działa w ogóle.
 *
 * Użyj: `npm run build:demo` → `npx cap sync android` → uruchom / zbuduj APK.
 * Nie wydawaj tego do sklepu — potem wróć do zwykłego `npm run build`.
 */
export const environment = {
  production: true,
  /** Jak w dev — opóźniony test HTTP po Sync (logcat / Safari Web Inspector). */
  simulateDeferredHttpAfterSync: true,
  localNotifyOnSyncSuccess: true,
  scheduledOpenAppReminder: {
    enabled: true,
    hour: 8,
    minute: 0,
  },
  remotePushWake: {
    enabled: false,
    apiBaseUrl: '',
    apiBearerToken: '',
  },
  demoRecordingPrivacy: true,
  versionCheck: {
    enabled: true,
    packageJsonUrl:
      'https://raw.githubusercontent.com/talareq/librus-client/main/package.json',
    repositoryPageUrl: 'https://github.com/talareq/librus-client/actions'
  }
};
