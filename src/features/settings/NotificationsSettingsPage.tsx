import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
} from '../../components/common';
import {
  Bell,
  ArrowLeft,
  CheckCircle2,
  CalendarClock,
  Save,
  Users,
} from 'lucide-react';
import { ROUTES } from '../../app/routes';

export const NotificationsSettingsPage: React.FC = () => {
  const [fixedExpenses48h, setFixedExpenses48h] = useState(true);
  const [fixedExpenses24h, setFixedExpenses24h] = useState(true);
  const [monthlyClosingReminder, setMonthlyClosingReminder] = useState(true);
  const [budgetAlerts, setBudgetAlerts] = useState(true);
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
        icon={<Bell className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Notifiche e Promemoria"
        subtitle="Configura gli avvisi sulle scadenze delle spese fisse, i promemoria di bilancio e le notifiche."
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
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Notifiche</span>
      </div>

      {savedMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">Preferenze di notifica salvate con successo.</span>
        </div>
      )}

      {/* Form Notifiche */}
      <form onSubmit={handleSave}>
        <DashboardCard>
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Avvisi Scadenze e Bilancio
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Scegli quali avvisi visualizzare nell'applicazione e sul dispositivo.
                  </p>
                </div>
              </div>
              <Badge variant="info">In-App</Badge>
            </div>

            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80">
                <label className="flex items-start justify-between cursor-pointer gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      Spese Fisse: Avviso 48 ore prima della scadenza
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Mostra un indicatore di attenzione quando una rata, bolletta o affitto è in scadenza entro 2 giorni.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={fixedExpenses48h}
                    onChange={(e) => setFixedExpenses48h(e.target.checked)}
                    className="w-4 h-4 mt-1 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                  />
                </label>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80">
                <label className="flex items-start justify-between cursor-pointer gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      Spese Fisse: Avviso 24 ore prima (Imminente)
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Evidenzia con priorità alta le spese in scadenza il giorno successivo.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={fixedExpenses24h}
                    onChange={(e) => setFixedExpenses24h(e.target.checked)}
                    className="w-4 h-4 mt-1 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                  />
                </label>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80">
                <label className="flex items-start justify-between cursor-pointer gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      Promemoria Chiusura Mensile Bilancio
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Ricevi una notifica il giorno prima e l'ultimo giorno del mese per la quadratura dei report.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={monthlyClosingReminder}
                    onChange={(e) => setMonthlyClosingReminder(e.target.checked)}
                    className="w-4 h-4 mt-1 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                  />
                </label>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80">
                <label className="flex items-start justify-between cursor-pointer gap-4">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      Avvisi di Superamento Soglia Budget
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Segnala quando le uscite complessive del mese superano il 90% del budget prudenziale.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={budgetAlerts}
                    onChange={(e) => setBudgetAlerts(e.target.checked)}
                    className="w-4 h-4 mt-1 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                  />
                </label>
              </div>
            </div>

            {/* Note Contributori Email */}
            <div className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div className="text-xs text-indigo-900 dark:text-indigo-200">
                  <p className="font-bold">Notifiche email individuali per Contributore</p>
                  <p className="text-indigo-700 dark:text-indigo-300">
                    Puoi attivare o disattivare gli avvisi email per ciascun membro nella pagina Contributori.
                  </p>
                </div>
              </div>
              <Link to={ROUTES.SETTINGS_CONTRIBUTORS}>
                <Button variant="secondary" size="sm">
                  Configura
                </Button>
              </Link>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                icon={<Save className="w-4 h-4" />}
              >
                Salva Notifiche
              </Button>
            </div>
          </div>
        </DashboardCard>
      </form>
    </div>
  );
};
