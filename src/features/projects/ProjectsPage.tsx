import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { projectRepository } from '../../repositories';
import { projectService } from '../../services/projectService';
import { formatCurrency } from '../../utils/formatters';
import {
  PageHeader,
  Modal,
  Button,
  Badge,
  DashboardCard,
} from '../../components/common';
import { FolderKanban, Plus, ShoppingCart, AlertCircle } from 'lucide-react';
import type { ProjectStatus } from '../../types';

export const ProjectsPage: React.FC = () => {
  const projects = useLiveQuery(() => projectRepository.getAll(), []);
  const activeCount = useLiveQuery(() => projectRepository.getActiveCount(), []) ?? 0;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [purchaseModalProject, setPurchaseModalProject] = useState<string | null>(null);

  // New Project Form
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState<number | ''>('');
  const [savedAmount, setSavedAmount] = useState<number | ''>(0);
  const [remainingMonths, setRemainingMonths] = useState<number>(6);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Purchase Form
  const [purchaseAmount, setPurchaseAmount] = useState<number | ''>('');
  const [purchaseDesc, setPurchaseDesc] = useState('');

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name || !targetAmount || Number(targetAmount) <= 0) return;

    try {
      const today = new Date().toISOString().substring(0, 10);
      const targetDate = new Date(Date.now() + remainingMonths * 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10);

      await projectService.createProject({
        slot: activeCount + 1,
        name,
        targetAmount: Number(targetAmount),
        savedAmount: Number(savedAmount) || 0,
        remainingMonths,
        startDate: today,
        targetDate,
        status: 'active',
      });

      setIsModalOpen(false);
      setName('');
      setTargetAmount('');
      setSavedAmount(0);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleProjectPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseModalProject || !purchaseAmount || Number(purchaseAmount) <= 0) return;

    await projectService.createProjectPurchaseExpense(
      purchaseModalProject,
      Number(purchaseAmount),
      purchaseDesc || 'Acquisto per progetto',
      new Date().toISOString().substring(0, 10),
    );

    setPurchaseModalProject(null);
    setPurchaseAmount('');
    setPurchaseDesc('');
  };

  const handleStatusChange = async (id: string, status: ProjectStatus) => {
    await projectRepository.update(id, { status });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Bar */}
      <PageHeader
        icon={<FolderKanban className="w-6 h-6 text-indigo-600" />}
        title="Progetti di Casa"
        subtitle={`Progetti Attivi: ${activeCount} / 3 massimo consentiti`}
        actions={
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            disabled={activeCount >= 3}
            onClick={() => {
              setErrorMsg(null);
              setIsModalOpen(true);
            }}
          >
            Nuovo Progetto
          </Button>
        }
      />

      {activeCount >= 3 && (
        <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 text-sm flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <span>Raggiunto il limite massimo di 3 progetti attivi contemporaneamente.</span>
        </div>
      )}

      {/* 5x4 Projects Grid Table */}
      <DashboardCard
        title="Elenco dei Progetti"
        subtitle="Riepilogo dei 3 progetti attivi consentiti"
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[1, 2, 3].map((slotNum) => {
                const proj = projects?.find((p) => p.slot === slotNum) || projects?.[slotNum - 1] || null;
                return (
                  <tr key={slotNum} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-4 font-bold text-slate-500 dark:text-slate-400 text-center">
                      {slotNum})
                    </td>
                    <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                      {proj ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-slate-900 dark:text-white">{proj.name}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant={proj.status === 'active' ? 'info' : proj.status === 'completed' ? 'success' : 'neutral'}>
                              {proj.status === 'active' ? 'Attivo' : proj.status === 'completed' ? 'Completato' : 'Annullato'}
                            </Badge>
                            {proj.status === 'active' && (
                              <button
                                onClick={() => setPurchaseModalProject(proj.id)}
                                title="Registra un acquisto per questo progetto"
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg font-medium text-xs hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                Acquisto
                              </button>
                            )}
                            <select
                              value={proj.status}
                              onChange={(e) => handleStatusChange(proj.id, e.target.value as ProjectStatus)}
                              className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="active">Attivo</option>
                              <option value="completed">Completato</option>
                              <option value="cancelled">Annullato</option>
                            </select>
                          </div>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DashboardCard>

      {/* Modal Nuovo Progetto */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nuovo Progetto (Max 3 Attivi)"
        subtitle="Pianifica un grande obiettivo di spesa o ristrutturazione"
      >
        {errorMsg && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleCreateProject} className="space-y-4 text-sm">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Nome Progetto</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Es. Ristrutturazione Bagno, Nuovo PC..."
              required
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Importo (€)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value ? parseFloat(e.target.value) : '')}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Importo Già Accumulato (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={savedAmount}
              onChange={(e) => setSavedAmount(e.target.value ? parseFloat(e.target.value) : 0)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Mesi Previsti per il Completamento</label>
            <input
              type="number"
              min="1"
              max="120"
              value={remainingMonths}
              onChange={(e) => setRemainingMonths(parseInt(e.target.value, 10) || 1)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Crea Progetto
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Registra Acquisto Progetto */}
      <Modal
        isOpen={!!purchaseModalProject}
        onClose={() => setPurchaseModalProject(null)}
        title="Acquisto Collegato al Progetto"
        subtitle="Genera automaticamente una spesa addebitata al progetto"
      >
        <form onSubmit={handleProjectPurchase} className="space-y-4 text-sm">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Descrizione Acquisto</label>
            <input
              type="text"
              value={purchaseDesc}
              onChange={(e) => setPurchaseDesc(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Es. Materiali, Piastrelle..."
              required
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Importo Spesa (€)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={purchaseAmount}
              onChange={(e) => setPurchaseAmount(e.target.value ? parseFloat(e.target.value) : '')}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0.00"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPurchaseModalProject(null)}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Genera Spesa
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
