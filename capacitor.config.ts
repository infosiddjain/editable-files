import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.easydocs.app',
  appName: 'EasyDocs',
  webDir: 'out', // static export from `npm run build:app`
  android: {
    // Keep the web content inside the app (no remote server)
    allowMixedContent: false,
  },
};

export default config;
