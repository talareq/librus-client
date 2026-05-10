// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

/** Sprawdzanie wersji względem package.json na gałęzi main — wyłączone w dev (npm start). */
export const environment = {
  production: false,
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
