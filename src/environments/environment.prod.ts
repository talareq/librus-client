export const environment = {
  production: true,
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
