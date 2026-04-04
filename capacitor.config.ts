import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.posyangu.app',
  appName: 'POS Yangu',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
