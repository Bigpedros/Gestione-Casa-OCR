import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { incomeRepository, contributorRepository } from '../../repositories';
import { formatCurrency, formatDate, getCurrentYearMonth, getMonthName } from '../../utils/formatters';
import {
  INCOME_TYPE_OPTIONS,
  getIncomeTypeLabel,
  mapContributorLabelToIncomeType,
  normalizeIncomeType,
  IncomeEntryTypeKey,
} from '../../utils/incomeTypeUtils';
import {
  EmptyState,
  Modal,
  Button,
  Badge,
} from '../../components/common';
import {
  Plus,
  TrendingUp,
  Calendar,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  AlertTriangle,
  Wallet,
  ArrowDownRight,
  Users,
  PieChart as PieChartIcon,
} from 'lucide-react';
import type { IncomeEntry, IncomeStatus } from '../../types';

const isCancelledStatus = (s?: string | null) => {
  if (!s) return false;
  const lower = s.toLowerCase();
  return (
    lower === 'cancelled' ||
    lower === 'canceled' ||
    lower === 'annullata' ||
    lower === 'annullato' ||
    lower === 'deleted' ||
    lower === 'inactive'
  );
};

export const IncomePage: React.FC = () => {
  const location = useLocation();
  const { year, month } = getCurrentYearMonth();
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedContributor, setSelectedContributor] = useState<string>('all');
  
  // Modal & Edit State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeEntry | null>(null);

  // Delete Confirmation State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingIncomeTarget, setDeletingIncomeTarget] = useState<IncomeEntry | null>(null);

  // Form State
  const [contributorId, setContributorId] = useState('');
  const [type, setType] = useState<IncomeEntryTypeKey>('salary');
  const [, setIsTypeManuallyModified] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [incomeDate, setIncomeDate] = useState(new Date().toISOString().substring(0, 10));
  const [status, setStatus] = useState<IncomeStatus>('received');
  const [formError, setFormError] = useState<string | null>(null);

  const activeContributors = useLiveQuery(() => contributorRepository.getActive(), []);
  const allContributors = useLiveQuery(() => contributorRepository.getAll(), []);
  const allIncomes = useLiveQuery(
    () => incomeRepository.getByMonthYear(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  );

  // Auto-open modal if triggered via action query param (e.g. from Home quick actions)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'new-income') {
      openNewModal();
    }
  }, [location.search]);

  const filteredIncomes = (allIncomes || []).filter(
    (inc) =>
      !isCancelledStatus(inc.status) &&
      (selectedContributor === 'all' || inc.contributorId === selectedContributor),
  );

  const totalIncome = filteredIncomes
    .filter((inc) => inc.status === 'received')
    .reduce((sum, inc) => sum + inc.amount, 0);

  const totalPlannedIncome = filteredIncomes
    .filter((inc) => inc.status === 'planned')
    .reduce((sum, inc) => sum + inc.amount, 0);

  // Group by contributor for summary panel
  const contributorSummary = React.useMemo(() => {
    const map = new Map<string, number>();
    filteredIncomes.forEach((inc) => {
      if (inc.status === 'received') {
        const cId = inc.contributorId || 'other';
        map.set(cId, (map.get(cId) || 0) + inc.amount);
      }
    });
    return Array.from(map.entries()).map(([cId, amt]) => {
      const contrib = (allContributors || []).find((c) => c.id === cId) || (activeContributors || []).find((c) => c.id === cId);
      const percentage = totalIncome > 0 ? Math.round((amt / totalIncome) * 100) : 0;
      return {
        id: cId,
        name: contrib?.name || 'Altro',
        amount: amt,
        percentage,
      };
    });
  }, [filteredIncomes, allContributors, activeContributors, totalIncome]);

  // Group by income type for summary panel
  const incomeByType = React.useMemo(() => {
    const map = new Map<string, number>();
    filteredIncomes.forEach((inc) => {
      if (inc.status === 'received') {
        const contrib =
          (allContributors || []).find((c) => c.id === inc.contributorId) ||
          (activeContributors || []).find((c) => c.id === inc.contributorId);
        const t = normalizeIncomeType(inc.type, contrib?.label);
        map.set(t, (map.get(t) || 0) + inc.amount);
      }
    });
    return Array.from(map.entries()).map(([tKey, amt]) => {
      const percentage = totalIncome > 0 ? Math.round((amt / totalIncome) * 100) : 0;
      return {
        id: tKey,
        label: getIncomeTypeLabel(tKey),
        amount: amt,
        percentage,
      };
    });
  }, [filteredIncomes, allContributors, activeContributors, totalIncome]);

  const availableContributorsOptions = React.useMemo(() => {
    const list = [...(activeContributors || [])];
    if (editingIncome && editingIncome.contributorId) {
      const existsInActive = list.some((c) => c.id === editingIncome.contributorId);
      if (!existsInActive) {
        const inactiveContrib = (allContributors || []).find((c) => c.id === editingIncome.contributorId);
        if (inactiveContrib) {
          list.push(inactiveContrib);
        } else {
          list.push({
            id: editingIncome.contributorId,
            name: 'Contributore storico',
            order: 999,
            active: false,
            metadata: { createdAt: '', updatedAt: '', version: 1 },
          });
        }
      }
    }
    return list;
  }, [activeContributors, allContributors, editingIncome]);

  const handleContributorSelect = (newContribId: string) => {
    setContributorId(newContribId);
    if (!newContribId) return;

    setIsTypeManuallyModified(false);

    const contrib =
      (allContributors || []).find((c) => c.id === newContribId) ||
      (activeContributors || []).find((c) => c.id === newContribId);

    setType(mapContributorLabelToIncomeType(contrib?.label));
  };

  const handleTypeSelect = (newType: IncomeEntryTypeKey) => {
    setType(newType);
    setIsTypeManuallyModified(true);
  };

  const openNewModal = () => {
    setEditingIncome(null);
    setFormError(null);
    setIsTypeManuallyModified(false);

    setContributorId('');
    setType('salary');

    setDescription('');
    setAmount('');
    setIncomeDate(new Date().toISOString().substring(0, 10));
    setStatus('received');
    setIsModalOpen(true);
  };

  const openEditModal = (inc: IncomeEntry) => {
    setEditingIncome(inc);
    setFormError(null);
    setIsTypeManuallyModified(false);

    setContributorId(inc.contributorId);

    const contrib =
      (allContributors || []).find((c) => c.id === inc.contributorId) ||
      (activeContributors || []).find((c) => c.id === inc.contributorId);

    setType(normalizeIncomeType(inc.type, contrib?.label));

    setDescription(inc.description || '');
    setAmount(inc.amount);
    setIncomeDate(inc.incomeDate || new Date().toISOString().substring(0, 10));
    setStatus(inc.status);
    setIsModalOpen(true);
  };

  const openDeleteModal = (inc: IncomeEntry) => {
    setDeletingIncomeTarget(inc);
    setIsDeleteModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!contributorId || contributorId.trim() === '') {
      setFormError('Seleziona un contributore.');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setFormError("Inserisci un importo valido e maggiore di zero.");
      return;
    }

    if (!incomeDate) {
      setFormError('Inserisci una data di incasso valida.');
      return;
    }

    const [yStr, mStr] = incomeDate.split('-');
    const cYear = parseInt(yStr, 10);
    const cMonth = parseInt(mStr, 10);

    if (isNaN(cYear) || isNaN(cMonth)) {
      setFormError('Data inserita non valida.');
      return;
    }

    try {
      if (editingIncome) {
        // Verify record exists before updating
        const existing = await incomeRepository.getById(editingIncome.id);
        if (!existing) {
          setFormError('Il record selezionato non esiste più nel database.');
          return;
        }

        await incomeRepository.update(editingIncome.id, {
          contributorId,
          type,
          description,
          amount: Number(amount),
          incomeDate,
          competenceMonth: cMonth,
          competenceYear: cYear,
          status,
        });
      } else {
        await incomeRepository.create({
          contributorId,
          type,
          description,
          amount: Number(amount),
          incomeDate,
          competenceMonth: cMonth,
          competenceYear: cYear,
          frequency: 'monthly',
          recurring: true,
          status,
        });
      }

      setIsModalOpen(false);
      setEditingIncome(null);
      setDescription('');
      setAmount('');
    } catch (err: unknown) {
      console.error('Errore durante il salvataggio dell’entrata:', err);
      setFormError('Si è verificato un errore durante il salvataggio. Riprova.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingIncomeTarget) return;
    try {
      await incomeRepository.delete(deletingIncomeTarget.id);
      setIsDeleteModalOpen(false);
      setDeletingIncomeTarget(null);
    } catch (err) {
      console.error('Errore durante l’eliminazione dell’entrata:', err);
    }
  };

  const handleStatusChange = async (id: string, newStatus: IncomeStatus) => {
    await incomeRepository.update(id, { status: newStatus });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header Bar conforme a Tavola SCR-PC-002 R02 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0 shadow-xs">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Entrate</h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Gestione stipendi e incassi mensili dei contributori
            </p>
          </div>
        </div>

        {/* Action Button: Nuova entrata */}
        <div className="flex items-center gap-3">
          <Button
            variant="emerald"
            icon={<Plus className="w-4 h-4" />}
            onClick={openNewModal}
            className="shadow-xs"
          >
            Nuova entrata
          </Button>
        </div>
      </div>

      {/* 2. Filtri Bar (Mese, Anno, Contributore) */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Periodo:</span>
          {/* Month Selector */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {getMonthName(m)}
              </option>
            ))}
          </select>

          {/* Year Selector */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="h-4 w-px bg-slate-200 hidden sm:block mx-1" />

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Contributore:</span>
          {/* Contributor Filter */}
          <select
            value={selectedContributor}
            onChange={(e) => setSelectedContributor(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-medium text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="all">Tutti i Contributori</option>
            {activeContributors?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.label ? `(${c.label})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3. 3 KPI Cards conformi a SCR-PC-002 R02 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* KPI 1: Entrate totali */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Entrate totali
            </span>
            <p className="text-2xl font-black text-emerald-600 mt-1">
              {formatCurrency(totalIncome)}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              {totalPlannedIncome > 0 ? `+ ${formatCurrency(totalPlannedIncome)} pianificati` : 'Importo effettivo incassato'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 2: Movimenti */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Movimenti
            </span>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {filteredIncomes.length}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              Nel mese selezionato
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <ArrowDownRight className="w-6 h-6" />
          </div>
        </div>

        {/* KPI 3: Contribuenti attivi */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Contribuenti attivi
            </span>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {activeContributors ? activeContributors.length : 0}
            </p>
            <span className="text-[11px] text-slate-400 font-medium">
              Configurati nel sistema
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <Users className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 4. Tabella / Elenco Entrate conforme a SCR-PC-002 R02 */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Elenco delle Entrate</h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {getMonthName(selectedMonth)} {selectedYear} — {filteredIncomes.length} {filteredIncomes.length === 1 ? 'entrata registrata' : 'entrate registrate'}
            </p>
          </div>
        </div>

        {filteredIncomes.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<TrendingUp className="w-7 h-7 text-emerald-500" />}
              title="Nessuna entrata trovata"
              description={`Nessuna entrata registrata per ${getMonthName(selectedMonth)} ${selectedYear}.`}
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredIncomes.map((inc) => {
              const contrib = (allContributors || []).find((c) => c.id === inc.contributorId) || (activeContributors || []).find((c) => c.id === inc.contributorId);
              return (
                <div key={inc.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-base">
                        {contrib?.name || 'Contributore'}
                      </span>
                      <Badge variant="info">{getIncomeTypeLabel(inc.type, contrib?.label)}</Badge>
                      <Badge
                        variant={
                          inc.status === 'received'
                            ? 'success'
                            : inc.status === 'planned'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {inc.status === 'received' ? 'Incassato' : inc.status === 'planned' ? 'Previsto' : inc.status}
                      </Badge>
                    </div>
                    {inc.description && <p className="text-xs text-slate-500">{inc.description}</p>}
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      Data: {formatDate(inc.incomeDate)}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 justify-between sm:justify-end">
                    <span className="text-lg font-extrabold text-emerald-600 whitespace-nowrap">
                      + {formatCurrency(inc.amount)}
                    </span>

                    <div className="flex items-center gap-1">
                      {inc.status !== 'received' && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(inc.id, 'received')}
                          className="p-2 rounded-xl text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          title="Segna come incassato"
                          aria-label={`Segna come incassato l'entrata di ${contrib?.name || ''}`}
                        >
                          <CheckCircle2 className="w-5 h-5" />
                        </button>
                      )}
                      {inc.status !== 'planned' && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(inc.id, 'planned')}
                          className="p-2 rounded-xl text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-amber-500"
                          title="Segna come previsto"
                          aria-label={`Segna come previsto l'entrata di ${contrib?.name || ''}`}
                        >
                          <Clock className="w-5 h-5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditModal(inc)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        title="Modifica entrata"
                        aria-label={`Modifica entrata: ${contrib?.name || ''} ${formatCurrency(inc.amount)}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeleteModal(inc)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-rose-500"
                        title="Elimina entrata"
                        aria-label={`Elimina entrata: ${contrib?.name || ''} ${formatCurrency(inc.amount)}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Pannelli Inferiori conformi a SCR-PC-002 R02 (Entrate per contribuente & Entrate per tipologia) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Entrate per contribuente */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-900 text-sm">Entrate per contribuente</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {getMonthName(selectedMonth)} {selectedYear}
            </span>
          </div>

          {contributorSummary.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 font-medium">
              Nessun dato disponibile.
            </div>
          ) : (
            <div className="space-y-3">
              {contributorSummary.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                    <span>{item.name}</span>
                    <span>{formatCurrency(item.amount)} ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Entrate per tipologia */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PieChartIcon className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-slate-900 text-sm">Entrate per tipologia</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {getMonthName(selectedMonth)} {selectedYear}
            </span>
          </div>

          {incomeByType.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 font-medium">
              Nessun dato disponibile.
            </div>
          ) : (
            <div className="space-y-3">
              {incomeByType.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                    <span>{item.label}</span>
                    <span>{formatCurrency(item.amount)} ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Nuova / Modifica Entrata */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingIncome(null);
        }}
        title={editingIncome ? 'Modifica Entrata' : 'Nuova Entrata Contributore'}
        subtitle={
          editingIncome
            ? 'Modifica i dati del movimento di entrata selezionato'
            : 'Registra uno stipendio o una nuova entrata mensile'
        }
      >
        <form onSubmit={handleSave} className="space-y-4 text-sm">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div>
            <label htmlFor="income-contributor-select" className="block font-medium text-slate-700 mb-1">Contributore</label>
            <select
              id="income-contributor-select"
              value={contributorId}
              onChange={(e) => handleContributorSelect(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              required
            >
              <option value="" disabled>
                Seleziona un contributore
              </option>
              {availableContributorsOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.label ? `(${c.label})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="income-type-select" className="block font-medium text-slate-700 mb-1">Tipologia di Entrata</label>
            <select
              id="income-type-select"
              value={type}
              onChange={(e) => handleTypeSelect(e.target.value as IncomeEntryTypeKey)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              {INCOME_TYPE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Importo (€)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value ? parseFloat(e.target.value) : '')}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="0.00"
              required
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Descrizione / Note</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Es. Stipendio mese corrente"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Data Incasso</label>
            <input
              type="date"
              value={incomeDate}
              onChange={(e) => setIncomeDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Stato</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as IncomeStatus)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="received">Incassato (Effettivo)</option>
              <option value="planned">Pianificato (Previsto)</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setEditingIncome(null);
              }}
            >
              Annulla
            </Button>
            <Button
              type="submit"
              variant="emerald"
            >
              {editingIncome ? 'Salva Modifiche' : 'Salva Entrata'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Conferma Eliminazione Entrata */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeletingIncomeTarget(null);
        }}
        title="Conferma eliminazione"
        subtitle="Eliminazione definitiva entrata"
      >
        <div className="space-y-4 text-sm">
          <p className="font-semibold text-slate-900 text-base">
            Vuoi eliminare definitivamente questa entrata?
          </p>

          {deletingIncomeTarget && (
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {(allContributors || []).find((c) => c.id === deletingIncomeTarget.contributorId)?.name || 'Contributore'}
                </span>
                <span>{formatDate(deletingIncomeTarget.incomeDate)}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="font-medium text-slate-900">
                  {deletingIncomeTarget.description || getIncomeTypeLabel(deletingIncomeTarget.type)}
                </span>
                <span className="font-bold text-emerald-600">
                  + {formatCurrency(deletingIncomeTarget.amount)}
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-rose-600 font-medium">
            Questa operazione non può essere annullata.
          </p>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setDeletingIncomeTarget(null);
              }}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="rose"
              onClick={handleConfirmDelete}
            >
              Elimina
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

