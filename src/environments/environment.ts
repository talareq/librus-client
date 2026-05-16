// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

/** Sprawdzanie wersji względem package.json na gałęzi main — wyłączone w dev (npm start). */
export const environment = {
  production: false,
  /**
   * Po udanym Sync: za 5 s testowy GET (CapacitorHttp + Cookie z jar) na dashboard Synergii — log w konsoli.
   * To nie jest prawdziwy „background OS”; wyłączone w production (`environment.prod.ts`).
   */
  simulateDeferredHttpAfterSync: true,
  /**
   * Po udanym Sync: lokalna notyfikacja „Synchronizacja zakończona” (test, bez serwera).
   * Wyłącz w production przed wydaniem, jeśli ma nie przeszkadzać użytkownikom.
   */
  localNotifyOnSyncSuccess: true,
  /**
   * Codzienne lokalne przypomnienie (bez serwera): otwórz apkę i zrób sync.
   * Wymaga uprawnień do powiadomień; harmonogram ustawia się przy starcie aplikacji.
   */
  scheduledOpenAppReminder: {
    enabled: true,
    hour: 8,
    minute: 0,
  },
  /**
   * Zdalny „budzik” FCM: mały backend w `backend/` zapisuje token i wywołuje `/v1/wake`.
   * Backend nie widzi ciasteczek Librus. Wymaga Firebase (`google-services.json` na Androidzie).
   */
  remotePushWake: {
    enabled: false,
    apiBaseUrl: '',
    /** Ten sam sekret co `API_SECRET` na serwerze (Authorization: Bearer …). */
    apiBearerToken: '',
  },
  /**
   * Tymczasowo na nagranie demo: rozmycie pól logowania w InAppBrowser + redakcja nazw/tekstów w UI.
   * Po nagraniu ustaw `false` i przebuduj aplikację.
   */
  demoRecordingPrivacy: true,
  versionCheck: {
    enabled: false,
    packageJsonUrl:
      'https://raw.githubusercontent.com/talareq/librus-client/main/package.json',
    /** Strona z buildami (Actions) albo Releases — użytkownik klika „Otwórz repozytorium”. */
    repositoryPageUrl: 'https://github.com/talareq/librus-client/actions'
  }
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
