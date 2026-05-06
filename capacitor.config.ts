import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.twojadomena.librus',
  appName: 'librus-client',
  webDir: 'www',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorCookies: {
      enabled: true, // TO JEST KLUCZ: Android zapamięta teraz sesję
    }
  },
};

export default config;
