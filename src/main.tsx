import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW({
  immediate: true,
  onNeedRefresh() {
    console.warn('Nuovo contenuto disponibile, aggiornamento Service Worker in corso...');
  },
  onOfflineReady() {
    console.warn('Applicazione pronta per l\'utilizzo offline.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
