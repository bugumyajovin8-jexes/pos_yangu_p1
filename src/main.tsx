import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { useStore } from './store';

// Register Service Worker for offline PWA support
const updateSW = registerSW({
  onNeedRefresh() {
    useStore.getState().showConfirm(
      'Sasisha',
      'Toleo jipya linapatikana. Je, unataka kusasisha?',
      () => updateSW(true)
    );
  },
  onOfflineReady() {
    console.log('App is ready to work offline');
  },
});

// Request Persistent Storage to prevent data loss
async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persisted();
    console.log(`Storage persisted: ${isPersisted}`);
    if (!isPersisted) {
      const granted = await navigator.storage.persist();
      console.log(`Storage persistence granted: ${granted}`);
    }
  }
}

requestPersistentStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
