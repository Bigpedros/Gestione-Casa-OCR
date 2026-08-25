import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
} from '../../components/common';
import {
  ScanLine,
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  Cpu,
  Save,
} from 'lucide-react';
import { ROUTES } from '../../app/routes';

export const OcrSettingsPage: React.FC = () => {
  const [minConfidence, setMinConfidence] = useState<number>(65);
  const [autoReview, setAutoReview] = useState<boolean>(true);
  const [saveReceiptImages, setSaveReceiptImages] = useState<boolean>(true);
  const [savedMsg, setSavedMsg] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        icon={<ScanLine className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Impostazioni OCR e Riconoscimento Scontrini"
        subtitle="Configura il motore locale di scansione, i parametri di confidenza e le modalità di revisione."
        actions={
          <Link to={ROUTES.SETTINGS}>
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Torna a Impostazioni
            </Button>
          </Link>
        }
      />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Link
          to={ROUTES.SETTINGS}
          className="hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 font-medium transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Impostazioni
        </Link>
        <span>/</span>
        <span className="text-slate-800 dark:text-slate-200 font-semibold">OCR</span>
      </div>

      {/* Privacy Notice */}
      <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-sm">Elaborazione 100% Locale e Riservata</p>
          <p className="text-emerald-700 dark:text-emerald-300 leading-relaxed">
            Il motore OCR (Tesseract.js / WebAssembly) elabora gli scontrini e le ricevute interamente all'interno del tuo browser. Nessuna immagine o dato personale viene trasmesso a server terzi o cloud esterni.
          </p>
        </div>
      </div>

      {savedMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">Impostazioni OCR salvate correttamente.</span>
        </div>
      )}

      {/* Form Settings */}
      <form onSubmit={handleSave}>
        <DashboardCard>
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Parametri Motore di Scansione
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ottimizza la precisione di estrazione prezzi, totali e righe scontrino.
                  </p>
                </div>
              </div>
              <Badge variant="info">Tesseract v5</Badge>
            </div>

            <div className="space-y-4">
              {/* Confidenza Minima */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-900 dark:text-white block">
                      Soglia Minima di Confidenza ({minConfidence}%)
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      I dati con livello di confidenza inferiore verranno evidenziati per revisione manuale.
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs rounded-xl">
                    {minConfidence}%
                  </span>
                </div>
                <input
                  type="range"
                  min={40}
                  max={90}
                  step={5}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              {/* Toggles */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                <label className="flex items-start justify-between cursor-pointer gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      Revisione Automatica Guidata
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Apri la schermata di verifica e rettifica prezzi subito dopo l'acquisizione dello scontrino.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoReview}
                    onChange={(e) => setAutoReview(e.target.checked)}
                    className="w-4 h-4 mt-1 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                  />
                </label>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                <label className="flex items-start justify-between cursor-pointer gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      Archiviazione Automatica Immagine Scontrino
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Salva la foto dello scontrino nella sezione Allegati associata alla spesa creata.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={saveReceiptImages}
                    onChange={(e) => setSaveReceiptImages(e.target.checked)}
                    className="w-4 h-4 mt-1 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                icon={<Save className="w-4 h-4" />}
              >
                Salva Preferenze OCR
              </Button>
            </div>
          </div>
        </DashboardCard>
      </form>
    </div>
  );
};
