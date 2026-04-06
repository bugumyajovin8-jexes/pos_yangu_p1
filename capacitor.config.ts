import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.venicssales.app',
  appName: 'Venics Sales',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
