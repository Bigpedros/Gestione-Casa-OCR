import React from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
} from '../../components/common';
import {
  Boxes,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Sparkles,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  PiggyBank,
  FileBarChart2,
  Store,
  Paperclip,
  HardDrive,
  ShoppingBag,
  Zap,
  Flame,
} from 'lucide-react';
import { ROUTES } from '../../app/routes';

interface ModuleItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'active' | 'upcoming';
  category: 'core' | 'extension';
}

const MODULES: ModuleItem[] = [
  // Core Modules (Attivi)
  {
    id: 'income',
    name: 'Gestione Entrate e Redditi',
    description: 'Tracciamento degli stipendi, pensioni, rendite e rimborsi per ciascun contributore del nucleo familiare.',
    icon: <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'expenses',
    name: 'Gestione Uscite e Scontrini',
    description: 'Registrazione delle spese quotidiane, scansione OCR degli scontrini con Tesseract locale e suddivisione per categoria.',
    icon: <TrendingDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'fixed-expenses',
    name: 'Spese Fisse e Scadenze',
    description: 'Pianificazione di mutui, affitti, rate ed abbonamenti con calendario delle scadenze e promemoria automatici.',
    icon: <CalendarClock className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'projects-savings',
    name: 'Progetti e Piani di Risparmio',
    description: 'Creazione di salvadanai digitali, obiettivi di risparmio e accantonamenti per ristrutturazioni e acquisti futuri.',
    icon: <PiggyBank className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'reports',
    name: 'Report e Chiusura Mensile',
    description: 'Quadratura patrimoniale, bilancio prudenziale consolidato, andamento temporale ed esportazione dati.',
    icon: <FileBarChart2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'suppliers',
    name: 'Anagrafica Fornitori',
    description: 'Elenco centralizzato dei negozi, supermercati e fornitori di servizi con associazione automatica degli scontrini.',
    icon: <Store className="w-5 h-5 text-purple-600 dark:text-purple-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'attachments',
    name: 'Allegati e Archiviazione',
    description: 'Archivio locale protetto per ricevute scontrini, fatture e documenti in formato PDF e immagini.',
    icon: <Paperclip className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />,
    status: 'active',
    category: 'core',
  },
  {
    id: 'backup',
    name: 'Backup e Ripristino Sicuro',
    description: 'Esportazione integrale del database locale in formato JSON crittografato e ripristino con controllo di integrità.',
    icon: <HardDrive className="w-5 h-5 text-slate-600 dark:text-slate-400" />,
    status: 'active',
    category: 'core',
  },

  // Upcoming Modules (Prossimamente / Non azionabili)
  {
    id: 'flyers-deals',
    name: 'Volantini e offerte',
    description: 'Comparatore promozioni e offerte dei volantini della grande distribuzione nella tua zona geografica.',
    icon: <ShoppingBag className="w-5 h-5 text-amber-500" />,
    status: 'upcoming',
    category: 'extension',
  },
  {
    id: 'waste-analysis',
    name: 'Analisi degli sprechi',
    description: 'Rilevamento automatico di spese ridondanti, abbonamenti dormienti e suggerimenti di ottimizzazione dei costi familiari.',
    icon: <Flame className="w-5 h-5 text-orange-500" />,
    status: 'upcoming',
    category: 'extension',
  },
  {
    id: 'utilities-contracts',
    name: 'Utenze e contratti',
    description: 'Monitoraggio consumi e tariffe per luce, gas, acqua e connettività internet con verifica delle condizioni contrattuali.',
    icon: <Zap className="w-5 h-5 text-yellow-500" />,
    status: 'upcoming',
    category: 'extension',
  },
];

export const ModulesSettingsPage: React.FC = () => {
  const activeModules = MODULES.filter((m) => m.status === 'active');
  const upcomingModules = MODULES.filter((m) => m.status === 'upcoming');

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        icon={<Boxes className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Moduli e Funzionalità"
        subtitle="Visualizza i moduli base attivi e scopri le funzionalità estese previste per la gestione della casa."
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
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Moduli</span>
      </div>

      {/* Sezione 1: Moduli Base Attivi */}
      <DashboardCard>
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Moduli Base della Casa
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Funzionalità standard incluse nella licenza e attive nell'applicazione.
              </p>
            </div>
            <Badge variant="success">{activeModules.length} Moduli Attivi</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeModules.map((module) => (
              <div
                key={module.id}
                className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex items-start gap-3.5"
              >
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 shrink-0 mt-0.5">
                  {module.icon}
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {module.name}
                    </h4>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full shrink-0">
                      <CheckCircle2 className="w-3 h-3" />
                      Attivo
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {module.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DashboardCard>

      {/* Sezione 2: Moduli in arrivo (Prossimamente / Non azionabili) */}
      <DashboardCard>
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Moduli in Arrivo
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Funzionalità opzionali ed estensioni in fase di rilascio.
                </p>
              </div>
            </div>
            <Badge variant="warning">Prossimamente</Badge>
          </div>

          <div className="space-y-4">
            {upcomingModules.map((module) => (
              <div
                key={module.id}
                className="p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30 flex items-start justify-between gap-4 opacity-80"
              >
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 shrink-0 mt-0.5">
                    {module.icon}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                        {module.name}
                      </h4>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/80 dark:bg-amber-950/60 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" />
                        Prossimamente
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
                      {module.description}
                    </p>
                  </div>
                </div>

                {/* Switch non azionabile / disabilitato */}
                <div className="shrink-0 pt-1">
                  <button
                    type="button"
                    disabled
                    aria-label={`Modulo ${module.name} non azionabile`}
                    className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full p-1 cursor-not-allowed opacity-50 relative"
                  >
                    <div className="w-4 h-4 bg-white rounded-full shadow-xs transform translate-x-0" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DashboardCard>
    </div>
  );
};
