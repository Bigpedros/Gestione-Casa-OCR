import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  projectRepository,
  projectMovementRepository,
  monthlySavingsGoalRepository,
} from '../../repositories';
import { projectService } from '../../services/projectService';
import { budgetService, type MonthlyBudgetSummary } from '../../services/budgetService';
import { formatCurrency, formatDate, getCurrentYearMonth, getMonthName } from '../../utils/formatters';
import {
  PageHeader,
  Modal,
  Button,
  Badge,
  DashboardCard,
  EmptyState,
} from '../../components/common';
import {
  FolderKanban,
  Plus,
  PiggyBank,
  Target,
  Sparkles,
  AlertCircle,
  Info,
  Calendar,
  History,
  CheckCircle2,
  Trash2,
  Edit3,
  ShoppingCart,
  ArrowDownToLine,
  Wallet,
  Layers,
} from 'lucide-react';
import type { Project, ProjectStatus } from '../../types';

export const ProjectsPage: React.FC = () => {
  const currentDate = useMemo(() => getCurrentYearMonth(), []);
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.year);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentDate.month);

  // Live queries
  const projects = useLiveQuery(() => projectRepository.getAll(), []) ?? [];
  const activeCount = useLiveQuery(() => projectRepository.getActiveCount(), []) ?? 0;
  const projectMovements = useLiveQuery(() => projectMovementRepository.getAll(), []) ?? [];
  const monthlyGoal = useLiveQuery(
    () => monthlySavingsGoalRepository.getByMonthYear(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  // Monthly budget summary for the selected period
  const monthlySummary = useLiveQuery(
    () => budgetService.calculateMonthlySummary(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  // Historical summaries for the trend chart (last 6 months)
  const historyTrend = useLiveQuery(async () => {
    const list: Array<{ year: number; month: number; label: string; surplus: number; totalSaved: number }> = [];
    const currentYM = selectedYear * 12 + selectedMonth;
    for (let i = 5; i >= 0; i--) {
      const ym = currentYM - i;
      const y = Math.floor((ym - 1) / 12);
      const m = ((ym - 1) % 12) + 1;
      const summary: MonthlyBudgetSummary = await budgetService.calculateMonthlySummary(y, m);
      list.push({
        year: y,
        month: m,
        label: `${getMonthName(m).substring(0, 3)} ${y}`,
        surplus: Math.max(0, summary.prudentialBalance),
        totalSaved: summary.savingPlanTotal + summary.projectQuotaTotal,
      });
    }
    return list;
  }, [selectedYear, selectedMonth]);

  // Tab State for "I tuoi progetti"
  const [projectTab, setProjectTab] = useState<'active' | 'completed' | 'cancelled'>('active');

  // Modals state
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositProjectId, setDepositProjectId] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<number | ''>('');
  const [depositDate, setDepositDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [depositNotes, setDepositNotes] = useState<string>('');

  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [goalAmount, setGoalAmount] = useState<number | ''>('');

  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseProjectId, setPurchaseProjectId] = useState<string>('');
  const [purchaseAmount, setPurchaseAmount] = useState<number | ''>('');
  const [purchaseDesc, setPurchaseDesc] = useState<string>('');

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isAllDepositsModalOpen, setIsAllDepositsModalOpen] = useState(false);
  const [showHistoryTable, setShowHistoryTable] = useState(false);

  // New Project Form State
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState<number | ''>('');
  const [savedAmount, setSavedAmount] = useState<number | ''>(0);
  const [remainingMonths, setRemainingMonths] = useState<number>(6);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtered projects by tab
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (projectTab === 'active') return p.status === 'active';
      if (projectTab === 'completed') return p.status === 'completed';
      if (projectTab === 'cancelled') return p.status === 'cancelled';
      return true;
    });
  }, [projects, projectTab]);

  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);
  const completedProjects = useMemo(() => projects.filter((p) => p.status === 'completed'), [projects]);
  const archivedProjects = useMemo(() => projects.filter((p) => p.status === 'cancelled'), [projects]);

  // Totals
  const totalSavedInProjects = useMemo(() => {
    return projects.reduce((sum, p) => sum + Number(p.savedAmount || 0), 0);
  }, [projects]);

  const totalActiveQuotas = useMemo(() => {
    return activeProjects.reduce((sum, p) => sum + Number(p.monthlyQuota || 0), 0);
  }, [activeProjects]);

  const availableSavings = useMemo(() => {
    if (!monthlySummary) return 0;
    return Math.max(0, monthlySummary.prudentialBalance);
  }, [monthlySummary]);

  const currentGoalValue = useMemo(() => {
    if (monthlyGoal && monthlyGoal.targetAmount > 0) return monthlyGoal.targetAmount;
    return totalActiveQuotas;
  }, [monthlyGoal, totalActiveQuotas]);

  // Deposits list
  const recentDeposits = useMemo(() => {
    return projectMovements.filter((m) => m.type === 'deposit').slice(0, 5);
  }, [projectMovements]);

  const allDeposits = useMemo(() => {
    return projectMovements.filter((m) => m.type === 'deposit');
  }, [projectMovements]);

  // Handlers
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim() || !targetAmount || Number(targetAmount) <= 0) {
      setErrorMsg('Inserisci un nome e un importo valido.');
      return;
    }

    try {
      const today = new Date().toISOString().substring(0, 10);
      const targetDate = new Date(Date.now() + remainingMonths * 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10);

      await projectService.createProject({
        slot: activeCount + 1,
        name: name.trim(),
        targetAmount: Number(targetAmount),
        savedAmount: Number(savedAmount) || 0,
        remainingMonths,
        startDate: today,
        targetDate,
        status: 'active',
      });

      setIsNewProjectModalOpen(false);
      setName('');
      setTargetAmount('');
      setSavedAmount(0);
      setRemainingMonths(6);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRecordDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositProjectId || !depositAmount || Number(depositAmount) <= 0) return;

    try {
      await projectService.recordDeposit(
        depositProjectId,
        Number(depositAmount),
        depositDate || new Date().toISOString().substring(0, 10),
        depositNotes.trim() || 'Versamento volontario al progetto'
      );

      setIsDepositModalOpen(false);
      setDepositProjectId('');
      setDepositAmount('');
      setDepositNotes('');
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (goalAmount === '' || Number(goalAmount) < 0) return;

    await monthlySavingsGoalRepository.setGoal(selectedYear, selectedMonth, Number(goalAmount));
    setIsGoalModalOpen(false);
  };

  const handleProjectPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseProjectId || !purchaseAmount || Number(purchaseAmount) <= 0) return;

    await projectService.createProjectPurchaseExpense(
      purchaseProjectId,
      Number(purchaseAmount),
      purchaseDesc.trim() || 'Acquisto per progetto',
      new Date().toISOString().substring(0, 10)
    );

    setIsPurchaseModalOpen(false);
    setPurchaseProjectId('');
    setPurchaseAmount('');
    setPurchaseDesc('');
  };

  const handleStatusChange = async (id: string, status: ProjectStatus) => {
    await projectRepository.update(id, { status });
  };

  const handleDeleteProject = async (id: string, projectName: string) => {
    if (window.confirm(`Sei sicuro di voler eliminare il progetto "${projectName}" e tutti i suoi versamenti?`)) {
      await projectRepository.delete(id);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;

    const newTarget = Number(editingProject.targetAmount);
    const newSaved = Number(editingProject.savedAmount);
    const newMonths = Math.max(1, Number(editingProject.remainingMonths));

    const quota = projectService.calculateMonthlyQuota(newTarget, newSaved, newMonths);
    const progress = projectService.calculateProgressPercentage(newTarget, newSaved);

    await projectRepository.update(editingProject.id, {
      name: editingProject.name.trim(),
      targetAmount: newTarget,
      savedAmount: newSaved,
      remainingMonths: newMonths,
      status: editingProject.status,
      monthlyQuota: quota,
      progressPercentage: progress,
    });

    setEditingProject(null);
  };

  const getProjectName = (projectId: string) => {
    const p = projects.find((item) => item.id === projectId);
    return p ? p.name : 'Progetto rimosso';
  };

  return (
    <div id="projects-page-container" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header Bar */}
      <PageHeader
        icon={<FolderKanban className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Progetti e Risparmi"
        subtitle="Trasforma il risparmio disponibile in obiettivi concreti."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Filtro Mese */}
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 shadow-xs">
              <Calendar className="w-4 h-4 text-slate-400" />
              <select
                id="select-month-filter"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
                className="text-xs font-semibold text-slate-800 dark:text-slate-200 bg-transparent border-none focus:outline-none cursor-pointer"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                  <option key={m} value={m} className="dark:bg-slate-900">
                    {getMonthName(m)}
                  </option>
                ))}
              </select>
            </div>

            {/* Filtro Anno */}
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 shadow-xs">
              <select
                id="select-year-filter"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                className="text-xs font-semibold text-slate-800 dark:text-slate-200 bg-transparent border-none focus:outline-none cursor-pointer"
              >
                {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                  <option key={y} value={y} className="dark:bg-slate-900">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* Pulsante Secondario: Registra versamento */}
            <Button
              id="btn-open-deposit-modal"
              variant="outline"
              icon={<ArrowDownToLine className="w-4 h-4" />}
              disabled={activeCount === 0}
              onClick={() => {
                if (activeProjects.length > 0) {
                  setDepositProjectId(activeProjects[0].id);
                }
                setIsDepositModalOpen(true);
              }}
            >
              Registra versamento
            </Button>

            {/* Pulsante Primario: Nuovo progetto */}
            <Button
              id="btn-open-new-project-modal"
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              disabled={activeCount >= 3}
              onClick={() => {
                setErrorMsg(null);
                setIsNewProjectModalOpen(true);
              }}
            >
              Nuovo progetto
            </Button>
          </div>
        }
      />

      {/* 2. Banner Informativo (SCR-PC-011) */}
      <div
        id="projects-info-banner"
        className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-indigo-950 dark:text-indigo-200 text-sm flex items-start sm:items-center gap-3 shadow-xs"
      >
        <div className="w-8 h-8 rounded-xl bg-indigo-600/10 dark:bg-indigo-400/20 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
          <Info className="w-4 h-4" />
        </div>
        <p className="leading-relaxed text-xs sm:text-sm font-medium">
          <span className="font-bold">I progetti raccolgono risparmio volontario</span>; gli accantonamenti sono quote collegate a spese future.
        </p>
      </div>

      {activeCount >= 3 && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Hai raggiunto il limite massimo di 3 progetti attivi in contemporanea.</span>
        </div>
      )}

      {/* 3. Quattro KPI Contabili (SCR-PC-011) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Risparmio disponibile */}
        <div
          id="kpi-available-savings"
          className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-5 shadow-xs flex items-center justify-between transition-all"
        >
          <div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
              Risparmio disponibile
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {formatCurrency(availableSavings)}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
              Saldo prudenziale {getMonthName(selectedMonth).toLowerCase()}
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400">
            <PiggyBank className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2: Obiettivo del mese */}
        <div
          id="kpi-month-savings-goal"
          className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/50 rounded-2xl p-5 shadow-xs flex items-center justify-between transition-all"
        >
          <div>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
              Obiettivo del mese
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {formatCurrency(currentGoalValue)}
            </p>
            <button
              id="btn-set-savings-goal"
              onClick={() => {
                setGoalAmount(currentGoalValue || '');
                setIsGoalModalOpen(true);
              }}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 block text-left"
            >
              {monthlyGoal ? 'Modifica obiettivo' : 'Imposta obiettivo'}
            </button>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0 text-indigo-600 dark:text-indigo-400">
            <Target className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 3: Progetti attivi */}
        <div
          id="kpi-active-projects-count"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex items-center justify-between transition-all"
        >
          <div>
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Progetti attivi
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {activeCount} <span className="text-sm font-semibold text-slate-400">/ 3</span>
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
              Slot consentiti nel piano
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 4: Totale accantonato */}
        <div
          id="kpi-total-saved-projects"
          className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-5 shadow-xs flex items-center justify-between transition-all"
        >
          <div>
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider block">
              Totale accantonato
            </span>
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {formatCurrency(totalSavedInProjects)}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 block">
              Nei tuoi progetti di casa
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0 text-amber-600 dark:text-amber-400">
            <Wallet className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 4. Sezione "I tuoi progetti" (SCR-PC-011) */}
      <DashboardCard
        title="I tuoi progetti"
        subtitle="Gestione degli obiettivi di risparmio e avanzamento delle quote accumulate"
        action={
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              id="tab-projects-active"
              onClick={() => setProjectTab('active')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                projectTab === 'active'
                  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Attivi ({activeProjects.length})
            </button>
            <button
              id="tab-projects-completed"
              onClick={() => setProjectTab('completed')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                projectTab === 'completed'
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Completati ({completedProjects.length})
            </button>
            <button
              id="tab-projects-archived"
              onClick={() => setProjectTab('cancelled')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                projectTab === 'cancelled'
                  ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Archiviati ({archivedProjects.length})
            </button>
          </div>
        }
      >
        {filteredProjects.length === 0 ? (
          <div className="py-8">
            <EmptyState
              title="Nessun progetto in questa sezione"
              description={
                projectTab === 'active'
                  ? 'Crea un nuovo progetto per iniziare a risparmiare e visualizzare qui il suo avanzamento.'
                  : projectTab === 'completed'
                  ? 'Nessun progetto completato al momento.'
                  : 'Nessun progetto archiviato o annullato.'
              }
              action={
                projectTab === 'active' && activeCount < 3 ? (
                  <Button
                    variant="primary"
                    icon={<Plus className="w-4 h-4" />}
                    onClick={() => {
                      setErrorMsg(null);
                      setIsNewProjectModalOpen(true);
                    }}
                  >
                    Crea il tuo primo progetto
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-2">
            {filteredProjects.map((proj) => {
              const remainingToSave = Math.max(0, proj.targetAmount - proj.savedAmount);
              const progressPct =
                proj.targetAmount > 0
                  ? Math.min(100, Math.round((proj.savedAmount / proj.targetAmount) * 100))
                  : 0;

              return (
                <div
                  key={proj.id}
                  id={`project-card-${proj.id}`}
                  className="bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-700/60 transition-all shadow-xs"
                >
                  {/* Top card header */}
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white text-base leading-snug">
                            {proj.name}
                          </h3>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                            Scadenza: {proj.targetDate ? formatDate(proj.targetDate) : `${proj.remainingMonths} mesi`}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={
                          proj.status === 'active'
                            ? 'info'
                            : proj.status === 'completed'
                            ? 'success'
                            : 'neutral'
                        }
                      >
                        {proj.status === 'active'
                          ? 'Attivo'
                          : proj.status === 'completed'
                          ? 'Completato'
                          : 'Archiviato'}
                      </Badge>
                    </div>

                    {/* Progress Bar & Percentage */}
                    <div className="mt-4 mb-4">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Avanzamento</span>
                        <span className="font-extrabold text-indigo-600 dark:text-indigo-400">{progressPct}%</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            progressPct >= 100
                              ? 'bg-emerald-500'
                              : 'bg-indigo-600 dark:bg-indigo-500'
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3 py-3 px-3.5 bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200/60 dark:border-slate-800/80 text-xs mb-4">
                      <div>
                        <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold tracking-wider block">
                          Accumulato
                        </span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                          {formatCurrency(proj.savedAmount)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold tracking-wider block">
                          Obiettivo
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white text-sm">
                          {formatCurrency(proj.targetAmount)}
                        </span>
                      </div>
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
                        <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold tracking-wider block">
                          Mancante
                        </span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          {formatCurrency(remainingToSave)}
                        </span>
                      </div>
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 text-right">
                        <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold tracking-wider block">
                          Quota mensile
                        </span>
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {formatCurrency(proj.monthlyQuota)}/m
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200/60 dark:border-slate-800">
                    <div className="flex items-center gap-1.5">
                      {proj.status === 'active' && (
                        <>
                          <button
                            id={`btn-deposit-proj-${proj.id}`}
                            onClick={() => {
                              setDepositProjectId(proj.id);
                              setDepositAmount('');
                              setIsDepositModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors"
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" />
                            Versa
                          </button>
                          <button
                            id={`btn-purchase-proj-${proj.id}`}
                            onClick={() => {
                              setPurchaseProjectId(proj.id);
                              setPurchaseAmount('');
                              setIsPurchaseModalOpen(true);
                            }}
                            title="Registra spesa per questo progetto"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-xl font-semibold text-xs transition-colors"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                            Spesa
                          </button>
                        </>
                      )}
                      {proj.status !== 'active' && (
                        <button
                          onClick={() => handleStatusChange(proj.id, 'active')}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          Riapri progetto
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingProject(proj)}
                        title="Modifica progetto"
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      {proj.status === 'active' && (
                        <button
                          onClick={() => handleStatusChange(proj.id, 'completed')}
                          title="Segna come completato"
                          className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteProject(proj.id, proj.name)}
                        title="Elimina progetto"
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardCard>

      {/* 5. Andamento del risparmio & 6. Ultimi versamenti (Due colonne SCR-PC-011) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pannello 5: Andamento del risparmio */}
        <DashboardCard
          title="Andamento del risparmio"
          subtitle="Evoluzione del risparmio accumulato e confronto con l'obiettivo"
          action={
            <button
              id="btn-toggle-savings-history"
              onClick={() => setShowHistoryTable(!showHistoryTable)}
              className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <History className="w-3.5 h-3.5" />
              {showHistoryTable ? 'Nascondi storico' : 'Vedi storico'}
            </button>
          }
        >
          <div className="space-y-4 mt-2">
            {/* Visual Indicators */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Totale accantonato</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {formatCurrency(totalSavedInProjects)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Obiettivo mese</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">
                  {formatCurrency(currentGoalValue)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Risparmio mese</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  {formatCurrency(availableSavings)}
                </span>
              </div>
            </div>

            {/* Visual Trend Bars (Last 6 months) */}
            {historyTrend && historyTrend.length > 0 ? (
              <div className="space-y-2 pt-2">
                <div className="flex items-end justify-between gap-2 h-36 pt-4 px-2">
                  {historyTrend.map((item, idx) => {
                    const maxVal = Math.max(1, ...historyTrend.map((h) => Math.max(h.surplus, h.totalSaved, 100)));
                    const barHeightPct = Math.min(100, Math.max(12, Math.round((item.surplus / maxVal) * 100)));
                    const isSelected = item.year === selectedYear && item.month === selectedMonth;

                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                        <div className="text-[10px] font-bold text-slate-600 dark:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                          €{Math.round(item.surplus)}
                        </div>
                        <div className="w-full max-w-[36px] bg-slate-100 dark:bg-slate-800 rounded-t-lg relative flex items-end h-24 overflow-hidden">
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 ${
                              isSelected
                                ? 'bg-indigo-600 dark:bg-indigo-500'
                                : 'bg-indigo-300 dark:bg-indigo-800/80 group-hover:bg-indigo-400'
                            }`}
                            style={{ height: `${barHeightPct}%` }}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-semibold truncate ${
                            isSelected ? 'text-indigo-600 dark:text-indigo-400 font-bold' : 'text-slate-500'
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-slate-400 italic">
                Nessun dato storico disponibile per il periodo selezionato.
              </div>
            )}

            {/* Historical Table View */}
            {showHistoryTable && historyTrend && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-slate-400 uppercase font-bold border-b border-slate-100 dark:border-slate-800 pb-2">
                      <th className="py-2">Mese</th>
                      <th className="py-2 text-right">Risparmio disponibile</th>
                      <th className="py-2 text-right">Quote accantonate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historyTrend.map((h, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{h.label}</td>
                        <td className="py-2 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(h.surplus)}
                        </td>
                        <td className="py-2 text-right font-semibold text-slate-600 dark:text-slate-400">
                          {formatCurrency(h.totalSaved)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DashboardCard>

        {/* Pannello 6: Ultimi versamenti */}
        <DashboardCard
          title="Ultimi versamenti"
          subtitle="Movimenti recenti registrati sui progetti di risparmio"
          action={
            allDeposits.length > 0 ? (
              <button
                id="btn-view-all-deposits"
                onClick={() => setIsAllDepositsModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Vedi tutti i versamenti ({allDeposits.length})
              </button>
            ) : undefined
          }
        >
          <div className="mt-2">
            {recentDeposits.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <PiggyBank className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                    Nessun versamento registrato.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Inizia a versare per far crescere i tuoi progetti.
                  </p>
                </div>
                {activeProjects.length > 0 && (
                  <Button
                    variant="primary"
                    icon={<ArrowDownToLine className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setDepositProjectId(activeProjects[0].id);
                      setIsDepositModalOpen(true);
                    }}
                  >
                    Registra versamento
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5 -mb-5">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2.5 px-4">Data</th>
                      <th className="py-2.5 px-4">Progetto</th>
                      <th className="py-2.5 px-4 text-right">Importo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {recentDeposits.map((mov) => (
                      <tr key={mov.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-400">
                          {formatDate(mov.movementDate)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          {getProjectName(mov.projectId)}
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                          + {formatCurrency(mov.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DashboardCard>
      </div>

      {/* MODAL 1: Nuovo Progetto (SCR-PC-011) */}
      <Modal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        title="Nuovo Progetto di Risparmio"
        subtitle="Configura un obiettivo concreto (Massimo 3 attivi)"
      >
        {errorMsg && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-medium border border-rose-200 dark:border-rose-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleCreateProject} className="space-y-4 text-sm">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Nome Progetto
            </label>
            <input
              id="input-new-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="Es. Ristrutturazione Bagno, Vacanze estive..."
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                Importo Obiettivo (€)
              </label>
              <input
                id="input-new-project-target"
                type="number"
                step="0.01"
                min="0.01"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value ? parseFloat(e.target.value) : '')}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                Capitale iniziale (€)
              </label>
              <input
                id="input-new-project-initial"
                type="number"
                step="0.01"
                min="0"
                value={savedAmount}
                onChange={(e) => setSavedAmount(e.target.value ? parseFloat(e.target.value) : 0)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Mesi previsti per il completamento
            </label>
            <input
              id="input-new-project-months"
              type="number"
              min="1"
              max="120"
              value={remainingMonths}
              onChange={(e) => setRemainingMonths(parseInt(e.target.value, 10) || 1)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              required
            />
          </div>

          {targetAmount && Number(targetAmount) > 0 && (
            <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/40 rounded-xl border border-indigo-200/60 dark:border-indigo-800/60 text-xs text-indigo-900 dark:text-indigo-300 flex justify-between items-center">
              <span>Quota mensile calcolata:</span>
              <span className="font-extrabold text-sm">
                {formatCurrency(
                  projectService.calculateMonthlyQuota(
                    Number(targetAmount),
                    Number(savedAmount) || 0,
                    remainingMonths
                  )
                )}
                /mese
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setIsNewProjectModalOpen(false)}>
              Annulla
            </Button>
            <Button id="btn-submit-create-project" type="submit" variant="primary">
              Crea Progetto
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 2: Registra Versamento (SCR-PC-011) */}
      <Modal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        title="Registra Versamento Volontario"
        subtitle="Aggiungi una somma al risparmio di un progetto attivo"
      >
        <form onSubmit={handleRecordDeposit} className="space-y-4 text-sm">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Seleziona Progetto
            </label>
            <select
              id="select-deposit-project"
              value={depositProjectId}
              onChange={(e) => setDepositProjectId(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              required
            >
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Obiettivo: {formatCurrency(p.targetAmount)} - Mancante:{' '}
                  {formatCurrency(Math.max(0, p.targetAmount - p.savedAmount))})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                Importo Versamento (€)
              </label>
              <input
                id="input-deposit-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value ? parseFloat(e.target.value) : '')}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                Data Versamento
              </label>
              <input
                id="input-deposit-date"
                type="date"
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Note (opzionale)
            </label>
            <input
              id="input-deposit-notes"
              type="text"
              value={depositNotes}
              onChange={(e) => setDepositNotes(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="Es. Quota mensile o risparmio extra..."
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setIsDepositModalOpen(false)}>
              Annulla
            </Button>
            <Button id="btn-submit-record-deposit" type="submit" variant="primary">
              Conferma Versamento
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 3: Imposta Obiettivo del Mese (SCR-PC-011) */}
      <Modal
        isOpen={isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(false)}
        title={`Obiettivo Risparmio per ${getMonthName(selectedMonth)} ${selectedYear}`}
        subtitle="Configura la soglia ideale di risparmio da raggiungere nel mese"
      >
        <form onSubmit={handleSaveGoal} className="space-y-4 text-sm">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Importo Obiettivo (€)
            </label>
            <input
              id="input-goal-amount"
              type="number"
              step="0.01"
              min="0"
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value ? parseFloat(e.target.value) : 0)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="0.00"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setIsGoalModalOpen(false)}>
              Annulla
            </Button>
            <Button id="btn-submit-savings-goal" type="submit" variant="primary">
              Salva Obiettivo
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 4: Modifica Progetto */}
      {editingProject && (
        <Modal
          isOpen={true}
          onClose={() => setEditingProject(null)}
          title="Modifica Progetto"
          subtitle="Aggiorna parametri e obiettivi"
        >
          <form onSubmit={handleUpdateProject} className="space-y-4 text-sm">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                Nome Progetto
              </label>
              <input
                type="text"
                value={editingProject.name}
                onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                  Importo Obiettivo (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editingProject.targetAmount}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      targetAmount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                  Totale Accumulato (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editingProject.savedAmount}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      savedAmount: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                  Mesi Rimanenti
                </label>
                <input
                  type="number"
                  min="1"
                  value={editingProject.remainingMonths}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      remainingMonths: parseInt(e.target.value, 10) || 1,
                    })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
                  Stato
                </label>
                <select
                  value={editingProject.status}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      status: e.target.value as ProjectStatus,
                    })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="active">Attivo</option>
                  <option value="completed">Completato</option>
                  <option value="cancelled">Archiviato/Annullato</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={() => setEditingProject(null)}>
                Annulla
              </Button>
              <Button type="submit" variant="primary">
                Salva Modifiche
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 5: Registra Spesa per Progetto */}
      <Modal
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        title="Spesa / Acquisto per Progetto"
        subtitle="Genera automaticamente un'uscita contabile collegata al progetto"
      >
        <form onSubmit={handleProjectPurchase} className="space-y-4 text-sm">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Descrizione Acquisto
            </label>
            <input
              type="text"
              value={purchaseDesc}
              onChange={(e) => setPurchaseDesc(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="Es. Acquisto sanitari, Nuovo computer..."
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 text-xs">
              Importo Spesa (€)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={purchaseAmount}
              onChange={(e) => setPurchaseAmount(e.target.value ? parseFloat(e.target.value) : '')}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="0.00"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setIsPurchaseModalOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" variant="primary">
              Genera Spesa
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 6: Tutti i Versamenti Registrati */}
      <Modal
        isOpen={isAllDepositsModalOpen}
        onClose={() => setIsAllDepositsModalOpen(false)}
        title="Tutti i Versamenti Registrati"
        subtitle={`Storico completo dei versamenti volontari (${allDeposits.length} registrati)`}
      >
        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
          {allDeposits.length === 0 ? (
            <p className="text-center py-6 text-slate-400 text-xs italic">Nessun versamento registrato.</p>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 sticky top-0">
                  <th className="py-2.5 px-3">Data</th>
                  <th className="py-2.5 px-3">Progetto</th>
                  <th className="py-2.5 px-3">Note</th>
                  <th className="py-2.5 px-3 text-right">Importo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {allDeposits.map((mov) => (
                  <tr key={mov.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {formatDate(mov.movementDate)}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                      {getProjectName(mov.projectId)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
                      {mov.notes || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      + {formatCurrency(mov.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
          <Button variant="secondary" onClick={() => setIsAllDepositsModalOpen(false)}>
            Chiudi
          </Button>
        </div>
      </Modal>
    </div>
  );
};
