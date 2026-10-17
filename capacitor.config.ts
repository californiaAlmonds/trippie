import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.californiaalmonds.trippie',
  appName: 'Trippie',
  webDir: 'capacitor-www',
  server: {
    url: 'https://trippie-mu.vercel.app',
    cleartext: false,
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
