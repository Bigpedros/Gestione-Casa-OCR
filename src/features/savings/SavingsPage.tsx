import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { projectRepository } from '../../repositories';
import { formatCurrency } from '../../utils/formatters';
import {
  PageHeader,
  Badge,
  DashboardCard,
} from '../../components/common';
import { PiggyBank } from 'lucide-react';

export const SavingsPage: React.FC = () => {
  const projects = useLiveQuery(() => projectRepository.getAll(), []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<PiggyBank className="w-6 h-6 text-emerald-600" />}
        title="Progressione Risparmi e Progetti"
        subtitle="Monitoraggio dell'accantonamento e progressione dei progetti di casa"
      />

      <DashboardCard
        title="Progressione dei Progetti"
        subtitle="Stato degli accantonamenti e somme rimanenti per i 3 progetti attivi"
      >
        <div className="overflow-x-auto -mx-5 -mb-5 mt-2">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                <th className="py-3.5 px-4 w-12 text-center">#</th>
                <th className="py-3.5 px-4">Nome Progetto</th>
                <th className="py-3.5 px-4 text-right">Importo</th>
                <th className="py-3.5 px-4 text-center">Durata in mesi</th>
                <th className="py-3.5 px-4 text-right">Accantonamento mensile</th>
                <th className="py-3.5 px-4 text-right">Totale Accantonato</th>
                <th className="py-3.5 px-4 text-right">Somma Restante da Accantonare</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[1, 2, 3].map((slotNum) => {
                const proj = projects?.find((p) => p.slot === slotNum) || projects?.[slotNum - 1] || null;
                const remainingToSave = proj ? Math.max(0, proj.targetAmount - proj.savedAmount) : 0;

                return (
                  <tr key={slotNum} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-4 font-bold text-slate-500 dark:text-slate-400 text-center">
                      {slotNum})
                    </td>
                    <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                      {proj ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-slate-900 dark:text-white">{proj.name}</span>
                          <Badge variant={proj.status === 'active' ? 'info' : proj.status === 'completed' ? 'success' : 'neutral'}>
                            {proj.status === 'active' ? 'Attivo' : proj.status === 'completed' ? 'Completato' : 'Annullato'}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-600 italic">Progetto {slotNum} non configurato</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-slate-800 dark:text-slate-200">
                      {proj ? formatCurrency(proj.targetAmount) : '—'}
                    </td>
                    <td className="py-4 px-4 text-center text-slate-700 dark:text-slate-300">
                      {proj ? `${proj.remainingMonths} mesi` : '—'}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-indigo-600 dark:text-indigo-400">
                      {proj ? `${formatCurrency(proj.monthlyQuota)}/mese` : '—'}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {proj ? formatCurrency(proj.savedAmount) : '—'}
                    </td>
                    <td className="py-4 px-4 text-right font-semibold text-amber-600 dark:text-amber-400">
                      {proj ? formatCurrency(remainingToSave) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DashboardCard>
    </div>
  );
};

