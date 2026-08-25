import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
} from '../../components/common';
import {
  Palette,
  ArrowLeft,
  Sun,
  Moon,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import type { ThemeMode } from '../../types';
import { ROUTES } from '../../app/routes';

export const AppearanceSettingsPage: React.FC = () => {
  const { themeMode, setThemeMode } = useTheme();
  const [savedMsg, setSavedMsg] = useState(false);

  const handleSaveTheme = async (mode: ThemeMode) => {
    try {
      await setThemeMode(mode);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
    } catch {
      // Ignora errori minori
    }
  };

  const getActiveBadgeLabel = () => {
    if (themeMode === 'light') return 'Tema Attivo: Chiaro';
    if (themeMode === 'pearl') return 'Tema Attivo: Perla';
    return 'Tema Attivo: Scuro';
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        icon={<Palette className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Aspetto e Tema Visivo"
        subtitle="Personalizza l'esperienza visiva dell'applicazione scegliendo tra la palette Chiaro - Sabbia, Perla - Default e Scuro - Antracite."
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
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Aspetto</span>
      </div>

      {/* Success Notification */}
      {savedMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">Tema visivo aggiornato e applicato con successo.</span>
        </div>
      )}

      {/* Theme Selection */}
      <DashboardCard>
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Modalità Colore
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seleziona la modalità di visualizzazione dell'interfaccia.
              </p>
            </div>
            <Badge variant="info">{getActiveBadgeLabel()}</Badge>
          </div>

          <div
            role="radiogroup"
            aria-label="Selezione tema visivo"
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            {/* 1. Chiaro - Sabbia */}
            <div
              role="radio"
              aria-checked={themeMode === 'light'}
              tabIndex={0}
              onClick={() => handleSaveTheme('light')}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveTheme('light');
                }
              }}
              className={`p-5 rounded-2xl border-2 text-left transition-all relative space-y-3 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-[#E5DCCB] ${
                themeMode === 'light'
                  ? 'border-indigo-600 dark:border-[#E5DCCB] bg-indigo-50/40 dark:bg-[#41464B]/60 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  <Sun className="w-5 h-5" />
                </div>
                {themeMode === 'light' && (
                  <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-[#E5DCCB]" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Chiaro</h4>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#F3EBD9] text-[#292721] border border-[#D6C6A8]">
                    Sabbia
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Palette calda e luminosa su toni sabbia (#F3EBD9) e card avorio chiaro.
                </p>
              </div>

              {/* Palette swatches preview */}
              <div className="flex items-center gap-1.5 pt-1">
                <span className="w-4 h-4 rounded-full border border-[#D6C6A8]" style={{ backgroundColor: '#F3EBD9' }} title="Fondo Sabbia" />
                <span className="w-4 h-4 rounded-full border border-[#D6C6A8]" style={{ backgroundColor: '#FFFDF7' }} title="Card Avorio" />
                <span className="w-4 h-4 rounded-full border border-[#D6C6A8]" style={{ backgroundColor: '#F8F1E3' }} title="Superfici" />
                <span className="w-4 h-4 rounded-full border border-[#D6C6A8]" style={{ backgroundColor: '#292721' }} title="Testo Principale" />
              </div>
            </div>

            {/* 2. Perla - Default */}
            <div
              role="radio"
              aria-checked={themeMode === 'pearl'}
              tabIndex={0}
              onClick={() => handleSaveTheme('pearl')}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveTheme('pearl');
                }
              }}
              className={`p-5 rounded-2xl border-2 text-left transition-all relative space-y-3 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-[#E5DCCB] ${
                themeMode === 'pearl'
                  ? 'border-indigo-600 dark:border-[#E5DCCB] bg-indigo-50/40 dark:bg-[#41464B]/60 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                  <Sparkles className="w-5 h-5" />
                </div>
                {themeMode === 'pearl' && (
                  <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-[#E5DCCB]" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Perla</h4>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#E3E4E1] text-[#292D32] border border-[#B5B9B5]">
                    DEFAULT
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Palette neutra e luminosa sui toni del grigio perla, predefinita su tutti i dispositivi.
                </p>
              </div>

              {/* Palette swatches preview */}
              <div className="flex items-center gap-1.5 pt-1">
                <span className="w-4 h-4 rounded-full border border-[#B5B9B5]" style={{ backgroundColor: '#E3E4E1' }} title="Fondo Grigio Perla" />
                <span className="w-4 h-4 rounded-full border border-[#B5B9B5]" style={{ backgroundColor: '#F7F7F3' }} title="Card Perla Chiara" />
                <span className="w-4 h-4 rounded-full border border-[#B5B9B5]" style={{ backgroundColor: '#E9EAE6' }} title="Superfici" />
                <span className="w-4 h-4 rounded-full border border-[#B5B9B5]" style={{ backgroundColor: '#292D32' }} title="Testo Principale" />
              </div>
            </div>

            {/* 3. Scuro - Antracite */}
            <div
              role="radio"
              aria-checked={themeMode === 'dark'}
              tabIndex={0}
              onClick={() => handleSaveTheme('dark')}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveTheme('dark');
                }
              }}
              className={`p-5 rounded-2xl border-2 text-left transition-all relative space-y-3 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-[#E5DCCB] ${
                themeMode === 'dark'
                  ? 'border-indigo-600 dark:border-[#E5DCCB] bg-indigo-50/40 dark:bg-[#41464B]/60 shadow-xs'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="p-2.5 rounded-xl bg-slate-800 text-indigo-400 dark:bg-slate-700 dark:text-[#E5DCCB]">
                  <Moon className="w-5 h-5" />
                </div>
                {themeMode === 'dark' && (
                  <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-[#E5DCCB]" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">Scuro</h4>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#222528] text-[#F2EDE2] border border-[#8D897F]">
                    Antracite
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Tonalità antracite (#222528) e card grigio perla scuro (#393D41) con contrasto calibrato.
                </p>
              </div>

              {/* Palette swatches preview */}
              <div className="flex items-center gap-1.5 pt-1">
                <span className="w-4 h-4 rounded-full border border-[#8D897F]" style={{ backgroundColor: '#222528' }} title="Fondo Antracite" />
                <span className="w-4 h-4 rounded-full border border-[#8D897F]" style={{ backgroundColor: '#393D41' }} title="Card Grigio Perla" />
                <span className="w-4 h-4 rounded-full border border-[#8D897F]" style={{ backgroundColor: '#41464B' }} title="Superfici" />
                <span className="w-4 h-4 rounded-full border border-[#8D897F]" style={{ backgroundColor: '#F2EDE2' }} title="Testo Avorio" />
              </div>
            </div>
          </div>
        </div>
      </DashboardCard>
    </div>
  );
};

