import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, Download, X } from 'lucide-react';

export const PWAReloadPrompt: React.FC = () => {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (r) {
        // Check for updates periodically (every hour)
        setInterval(() => {
          r.update().catch(() => {});
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('Service Worker registration failed:', error);
    },
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  if (!offlineReady && !needRefresh) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-20 md:bottom-6 right-4 z-50 max-w-sm bg-slate-900 text-white dark:bg-slate-800 p-4 rounded-2xl shadow-2xl border border-slate-700/50 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {needRefresh ? (
            <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin" />
          ) : (
            <Download className="w-5 h-5 text-emerald-400" />
          )}
          <div>
            <h4 className="text-sm font-semibold">
              {needRefresh ? 'Nuova versione disponibile' : 'Pronta offline'}
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              {needRefresh
                ? 'È disponibile un aggiornamento per Gestione Casa.'
                : "L'applicazione è pronta per funzionare offline."}
            </p>
          </div>
        </div>
        <button
          onClick={close}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          aria-label="Chiudi notifica"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
        {needRefresh && (
          <button
            onClick={() => updateServiceWorker(true)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
          >
            Aggiorna ora
          </button>
        )}
        <button
          onClick={close}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
        >
          {needRefresh ? 'Più tardi' : 'Ho capito'}
        </button>
      </div>
    </div>
  );
};
