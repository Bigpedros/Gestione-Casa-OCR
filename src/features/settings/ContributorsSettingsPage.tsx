import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { contributorRepository } from '../../repositories';
import {
  isUnusedPlaceholderContributor,
  filterVisibleContributors,
} from '../../utils/contributorUtils';
import {
  PageHeader,
  DashboardCard,
  Button,
} from '../../components/common';
import {
  Users,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Save,
} from 'lucide-react';
import type { Contributor } from '../../types';
import { ROUTES } from '../../app/routes';

const CONTRIBUTOR_NAME_REGEX = /^[\p{L}]+(?:\s+[\p{L}]+)*$/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ContributorsSettingsPage: React.FC = () => {
  const dbContributors = useLiveQuery(() => contributorRepository.getAll(), []);
  const dbIncomeEntries = useLiveQuery(() => db.incomeEntries.toArray(), []);

  const referencedContributorIds = useMemo(() => {
    const set = new Set<string>();
    if (dbIncomeEntries) {
      for (const inc of dbIncomeEntries) {
        if (inc.contributorId) {
          set.add(inc.contributorId);
        }
      }
    }
    return set;
  }, [dbIncomeEntries]);

  const [editedContributors, setEditedContributors] = useState<Contributor[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (dbContributors && dbIncomeEntries !== undefined && !isInitialized) {
      if (dbContributors.length === 0) {
        const now = new Date().toISOString();
        setEditedContributors([
          {
            id: 'contrib-1',
            order: 1,
            name: '',
            label: 'Stipendio',
            active: true,
            email: '',
            receiveDeadlineEmails: false,
            receive48HourReminder: false,
            receive24HourReminder: false,
            emailDeliveryStatus: 'provider_not_configured',
            colorToken: '#4F46E5',
            metadata: { createdAt: now, updatedAt: now, version: 1 },
          },
        ]);
      } else {
        const visible = filterVisibleContributors(dbContributors, referencedContributorIds);
        setEditedContributors(visible);
      }
      setIsInitialized(true);
    }
  }, [dbContributors, dbIncomeEntries, isInitialized, referencedContributorIds]);

  const handleUpdateField = (id: string, field: keyof Contributor, value: any) => {
    setEditedContributors((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  };

  const handleAddContributor = () => {
    if (editedContributors.length >= 3) {
      setErrorMsg('Massimo tre contributori consentiti');
      return;
    }
    const currentCount = editedContributors.length;
    const nextOrder = currentCount + 1;
    const now = new Date().toISOString();

    const existingPlaceholder = (dbContributors || []).find(
      (c) =>
        !editedContributors.some((ec) => ec.id === c.id) &&
        (c.order === nextOrder || c.id === `contrib-${nextOrder}` || isUnusedPlaceholderContributor(c, referencedContributorIds))
    );

    let newContrib: Contributor;
    if (existingPlaceholder) {
      const rawName = (existingPlaceholder.name || '').trim();
      const isPlaceholderName =
        !rawName ||
        /^contributore(\s*\d*)?$/i.test(rawName) ||
        /^(secondo|terzo)\s+contributore$/i.test(rawName);
      const rawEmail = (existingPlaceholder.email || '').trim().toLowerCase();
      const isPlaceholderEmail =
        !rawEmail ||
        rawEmail === 'nome@esempio.com' ||
        rawEmail.includes('esempio');

      newContrib = {
        ...existingPlaceholder,
        order: nextOrder,
        name: isPlaceholderName ? '' : existingPlaceholder.name,
        email: isPlaceholderEmail ? '' : existingPlaceholder.email,
        active: true,
        label: existingPlaceholder.label || 'Stipendio',
        colorToken: nextOrder === 1 ? '#4F46E5' : nextOrder === 2 ? '#0EA5E9' : '#10B981',
      };
    } else {
      newContrib = {
        id: `contrib-${nextOrder}`,
        order: nextOrder,
        name: '',
        label: 'Stipendio',
        active: true,
        email: '',
        receiveDeadlineEmails: false,
        receive48HourReminder: false,
        receive24HourReminder: false,
        emailDeliveryStatus: 'provider_not_configured',
        colorToken: nextOrder === 1 ? '#4F46E5' : nextOrder === 2 ? '#0EA5E9' : '#10B981',
        metadata: { createdAt: now, updatedAt: now, version: 1 },
      };
    }

    setEditedContributors((prev) => [...prev, newContrib]);
    setErrorMsg(null);
  };

  const handleRemoveContributor = (id: string) => {
    if (editedContributors.length <= 1) {
      setErrorMsg('Deve essere presente almeno un contributore');
      return;
    }
    const target = editedContributors.find((c) => c.id === id);
    if (!target) return;

    if (referencedContributorIds.has(id)) {
      setErrorMsg(`Impossibile eliminare ${target.name || 'il contributore'}: associato a movimenti di entrata registrati.`);
      return;
    }

    setEditedContributors((prev) =>
      prev
        .filter((c) => c.id !== id)
        .map((c, idx) => ({ ...c, order: idx + 1 }))
    );
    setErrorMsg(null);
  };

  const handleSaveContributors = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    // Validation
    for (const [index, c] of editedContributors.entries()) {
      const trimmedName = c.name.trim().replace(/\s+/g, ' ');
      if (!trimmedName) {
        setErrorMsg(`Il nome del Contributore ${index + 1} è obbligatorio.`);
        return;
      }
      if (!CONTRIBUTOR_NAME_REGEX.test(trimmedName)) {
        setErrorMsg(
          `Il nome del Contributore ${index + 1} ("${trimmedName}") contiene caratteri non validi. Sono ammesse solo lettere e spazi.`
        );
        return;
      }

      if (c.email && c.email.trim()) {
        const trimmedEmail = c.email.trim();
        if (!EMAIL_REGEX.test(trimmedEmail)) {
          setErrorMsg(`L'indirizzo email del Contributore ${index + 1} non è valido.`);
          return;
        }
      }
    }

    try {
      const now = new Date().toISOString();
      const updatedContributors: Contributor[] = editedContributors.map((c, idx) => ({
        ...c,
        order: idx + 1,
        name: c.name.trim().replace(/\s+/g, ' '),
        email: c.email ? c.email.trim() : '',
        active: true,
        metadata: {
          ...c.metadata,
          updatedAt: now,
          version: (c.metadata?.version || 1) + 1,
        },
      }));

      // Mantieni eventuali altri contributori del DB non presenti a schermo ma referenziati
      const existingDbList = await db.contributors.toArray();
      const keptOtherContributors = existingDbList
        .filter((dbC) => !updatedContributors.some((u) => u.id === dbC.id))
        .map((dbC) => ({
          ...dbC,
          active: referencedContributorIds.has(dbC.id),
        }));

      const finalToSave = [...updatedContributors, ...keptOtherContributors];
      await contributorRepository.saveAll(finalToSave);

      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
    } catch {
      setErrorMsg('Errore durante il salvataggio dei contributori.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        icon={<Users className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Contributori Nucleo Familiare"
        subtitle="Gestisci i membri del nucleo familiare (fino a 3), le tipologie di entrata e le notifiche."
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
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Contributori</span>
      </div>

      {/* Success Notification */}
      {savedMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">Contributori salvati con successo.</span>
        </div>
      )}

      {/* Error Notification */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      {/* Contributori Form Card */}
      <DashboardCard>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Elenco Contributori
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Definisci chi contribuisce alle spese e al bilancio della casa (minimo 1, massimo 3).
              </p>
            </div>
            {editedContributors.length < 3 ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={handleAddContributor}
              >
                + Aggiungi contributore
              </Button>
            ) : (
              <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Limite massimo raggiunto (3 contributori)
              </span>
            )}
          </div>

          <form onSubmit={handleSaveContributors} className="space-y-6">
            <div className="space-y-4">
              {editedContributors.map((c, index) => (
                <div
                  key={c.id}
                  className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-4 relative transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-slate-800 shadow-xs"
                        style={{ backgroundColor: c.colorToken || '#4F46E5' }}
                      />
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        Contributore {index + 1}
                      </span>
                    </div>

                    {editedContributors.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="w-4 h-4 text-rose-500 hover:text-rose-600" />}
                        onClick={() => handleRemoveContributor(c.id)}
                        aria-label={`Rimuovi Contributore ${index + 1}`}
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                    <div className="sm:col-span-4 space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Nome Contributore *
                      </label>
                      <input
                        type="text"
                        placeholder="Es. Mario Rossi"
                        value={c.name}
                        onChange={(e) => handleUpdateField(c.id, 'name', e.target.value)}
                        className="w-full text-sm px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>

                    <div className="sm:col-span-4 space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Tipologia Contributo
                      </label>
                      <select
                        value={c.label || 'Stipendio'}
                        onChange={(e) => handleUpdateField(c.id, 'label', e.target.value)}
                        className="w-full text-sm px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="Stipendio">Stipendio</option>
                        <option value="Pensione">Pensione</option>
                        <option value="Rendita">Rendita</option>
                        <option value="Rimborso">Rimborso</option>
                        <option value="Altro">Altro</option>
                      </select>
                    </div>

                    <div className="sm:col-span-4 space-y-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Indirizzo Email (opzionale)
                      </label>
                      <input
                        type="email"
                        placeholder="nome@esempio.com"
                        value={c.email || ''}
                        onChange={(e) => handleUpdateField(c.id, 'email', e.target.value)}
                        className="w-full text-sm px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Promemoria Email / Scadenze */}
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 space-y-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 block">
                      Promemoria Scadenze Spese Fisse
                    </span>
                    <div className="flex flex-wrap items-center gap-6">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={!!c.receive48HourReminder}
                          onChange={(e) => handleUpdateField(c.id, 'receive48HourReminder', e.target.checked)}
                          className="w-4 h-4 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                        />
                        <span>Avviso 48 ore prima</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={!!c.receive24HourReminder}
                          onChange={(e) => handleUpdateField(c.id, 'receive24HourReminder', e.target.checked)}
                          className="w-4 h-4 rounded-sm text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-600"
                        />
                        <span>Avviso 24 ore prima</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                icon={<Save className="w-4 h-4" />}
              >
                Salva Modifiche Contributori
              </Button>
            </div>
          </form>
        </div>
      </DashboardCard>
    </div>
  );
};
