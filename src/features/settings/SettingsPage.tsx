import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/common';
import {
  Settings,
  Home,
  Users,
  Tags,
  Store,
  ScanText,
  Bell,
  Palette,
  Boxes,
  HardDrive,
  Paperclip,
  KeyRound,
  Headphones,
  ChevronRight,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ROUTES } from '../../app/routes';
import { useLicense } from '../../hooks/useLicense';

interface SettingsCardProps {
  to: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
}

const SettingsCard: React.FC<SettingsCardProps> = ({
  to,
  icon,
  iconBg,
  title,
  description,
  badge,
}) => {
  return (
    <Link
      to={to}
      className="group p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-md transition-all flex flex-col justify-between"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={`p-3 rounded-2xl ${iconBg} shrink-0 transition-transform group-hover:scale-105`}>
            {icon}
          </div>
          {badge}
        </div>
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white text-base group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors flex items-center justify-between">
            <span>{title}</span>
            <ChevronRight className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
};

export const SettingsPage: React.FC = () => {
  const { isValid: isLicenseValid } = useLicense();

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <PageHeader
        icon={<Settings className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Impostazioni"
        subtitle="Configura le preferenze, gestisci il nucleo familiare, i dati locali, le categorie e la licenza d'uso."
      />

      {/* 1. GESTIONE DELLA CASA */}
      <section className="space-y-4">
        <div className="border-b border-slate-200/80 dark:border-slate-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Home className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            1. Gestione della Casa
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SettingsCard
            to={ROUTES.SETTINGS_GENERAL}
            icon={<Home className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            iconBg="bg-indigo-50 dark:bg-indigo-950/50"
            title="Generali"
            description="Indirizzo abitazione, CAP, preferenze di calcolo e valuta predefinita."
          />

          <SettingsCard
            to={ROUTES.SETTINGS_CONTRIBUTORS}
            icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            iconBg="bg-blue-50 dark:bg-blue-950/50"
            title="Contributori"
            description="Membri del nucleo familiare, etichette reddito e gestione stipendi."
          />

          <SettingsCard
            to={ROUTES.SETTINGS_CATEGORIES}
            icon={<Tags className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-50 dark:bg-emerald-950/50"
            title="Categorie"
            description="Albero tassonomico delle spese con icone, colori e sottocategorie."
          />

          <SettingsCard
            to={ROUTES.SUPPLIERS}
            icon={<Store className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            iconBg="bg-purple-50 dark:bg-purple-950/50"
            title="Fornitori"
            description="Anagrafica negozi, supermercati e fornitori di servizi per gli scontrini."
          />
        </div>
      </section>

      {/* 2. ESPERIENZA E FUNZIONALITÀ */}
      <section className="space-y-4">
        <div className="border-b border-slate-200/80 dark:border-slate-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            2. Esperienza e Funzionalità
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SettingsCard
            to={ROUTES.SETTINGS_OCR}
            icon={<ScanText className="w-5 h-5 text-sky-600 dark:text-sky-400" />}
            iconBg="bg-sky-50 dark:bg-sky-950/50"
            title="OCR"
            description="Motore Tesseract locale, lingua di riconoscimento e filtri di contrasto scontrini."
          />

          <SettingsCard
            to={ROUTES.SETTINGS_NOTIFICATIONS}
            icon={<Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-50 dark:bg-amber-950/50"
            title="Notifiche"
            description="Avvisi scadenze spese fisse, promemoria backup e chiusura del mese."
          />

          <SettingsCard
            to={ROUTES.SETTINGS_APPEARANCE}
            icon={<Palette className="w-5 h-5 text-pink-600 dark:text-pink-400" />}
            iconBg="bg-pink-50 dark:bg-pink-950/50"
            title="Aspetto"
            description="Modalità tema (Chiaro, Scuro, Default di Sistema) e contrasto visivo."
          />

          <SettingsCard
            to={ROUTES.SETTINGS_MODULES}
            icon={<Boxes className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            iconBg="bg-indigo-50 dark:bg-indigo-950/50"
            title="Moduli"
            description="Panoramica moduli base attivi e prossime estensioni in arrivo."
          />
        </div>
      </section>

      {/* 3. DATI E ASSISTENZA */}
      <section className="space-y-4">
        <div className="border-b border-slate-200/80 dark:border-slate-800 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            3. Dati e Assistenza
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SettingsCard
            to={ROUTES.BACKUP}
            icon={<HardDrive className="w-5 h-5 text-slate-600 dark:text-slate-300" />}
            iconBg="bg-slate-100 dark:bg-slate-800"
            title="Backup"
            description="Esportazione JSON con manifest e ripristino sicuro con backup preventivo."
          />

          <SettingsCard
            to={ROUTES.ATTACHMENTS}
            icon={<Paperclip className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />}
            iconBg="bg-cyan-50 dark:bg-cyan-950/50"
            title="Allegati"
            description="Archivio ricevute, documenti PDF, calcolo spazio e conservazione 6 mesi."
          />

          <SettingsCard
            to={ROUTES.LICENSE}
            icon={<KeyRound className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-50 dark:bg-amber-950/50"
            title="Licenza"
            description="Stato licenza, codice di attivazione e modalità d'uso offline."
            badge={
              isLicenseValid ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Attiva
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                  Da attivare
                </span>
              )
            }
          />

          <SettingsCard
            to={ROUTES.CONTACT}
            icon={<Headphones className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
            iconBg="bg-teal-50 dark:bg-teal-950/50"
            title="Supporto"
            description="Contatti per assistenza, richiesta aiuto e informazioni di versione."
          />
        </div>
      </section>
    </div>
  );
};
