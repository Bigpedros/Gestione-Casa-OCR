import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import { categoryRepository } from '../../repositories';
import {
  PageHeader,
  DashboardCard,
  Button,
  Badge,
  Modal,
} from '../../components/common';
import {
  Tags,
  ArrowLeft,
  Search,
  FolderTree,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Plus,
} from 'lucide-react';
import type { Category } from '../../types';
import { ROUTES } from '../../app/routes';

export const CategoriesSettingsPage: React.FC = () => {
  const allCategories = useLiveQuery(() => categoryRepository.getAll(), []);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTab, setSelectedTab] = useState<'all' | 'expense' | 'income'>('all');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  // Modals for creating category and subcategory
  const [isNewCatModalOpen, setIsNewCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'expense' | 'income'>('expense');
  const [catError, setCatError] = useState('');

  const [selectedParentForSub, setSelectedParentForSub] = useState<Category | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [subError, setSubError] = useState('');

  const parentCategories = React.useMemo(() => {
    if (!allCategories) return [];
    return allCategories.filter((c) => c.level === 1 || !c.parentId);
  }, [allCategories]);

  const subCategoriesByParent = React.useMemo(() => {
    const map = new Map<string, Category[]>();
    if (!allCategories) return map;
    for (const c of allCategories) {
      if (c.parentId) {
        const list = map.get(c.parentId) || [];
        list.push(c);
        map.set(c.parentId, list);
      }
    }
    return map;
  }, [allCategories]);

  const filteredParents = React.useMemo(() => {
    return parentCategories.filter((cat) => {
      const matchesTab = selectedTab === 'all' || cat.type === selectedTab;
      if (!matchesTab) return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.trim().toLowerCase();
      const nameMatches = cat.name.toLowerCase().includes(term);
      const subcats = subCategoriesByParent.get(cat.id) || [];
      const subcatMatches = subcats.some((s) => s.name.toLowerCase().includes(term));
      return nameMatches || subcatMatches;
    });
  }, [parentCategories, subCategoriesByParent, searchTerm, selectedTab]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategoryId((prev) => (prev === categoryId ? null : categoryId));
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setCatError('Il nome della categoria è obbligatorio.');
      return;
    }

    const exists = parentCategories.some(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase() && c.type === newCatType,
    );
    if (exists) {
      setCatError('Esiste già una categoria con questo nome.');
      return;
    }

    const now = new Date().toISOString();
    const id = `cat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newCat: Category = {
      id,
      parentId: null,
      name: trimmed,
      code: `CAT_${trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${Date.now()}`,
      type: newCatType,
      level: 1,
      enabled: true,
      system: false,
      sortOrder: (parentCategories.length || 0) + 1,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await db.categories.put(newCat);
    setNewCatName('');
    setCatError('');
    setIsNewCatModalOpen(false);
    setExpandedCategoryId(id);
  };

  const handleCreateSubcategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedParentForSub) return;
    const trimmed = newSubName.trim();
    if (!trimmed) {
      setSubError('Il nome della sottocategoria è obbligatorio.');
      return;
    }

    const existingSubs = subCategoriesByParent.get(selectedParentForSub.id) || [];
    const exists = existingSubs.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setSubError('Esiste già una sottocategoria con questo nome.');
      return;
    }

    const now = new Date().toISOString();
    const id = `cat-sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newSub: Category = {
      id,
      parentId: selectedParentForSub.id,
      name: trimmed,
      code: `${selectedParentForSub.code}_SUB_${Date.now()}`,
      type: selectedParentForSub.type,
      level: 2,
      enabled: true,
      system: false,
      sortOrder: existingSubs.length + 1,
      metadata: { createdAt: now, updatedAt: now, version: 1 },
    };

    await db.categories.put(newSub);
    setNewSubName('');
    setSubError('');
    const parentIdToExpand = selectedParentForSub.id;
    setSelectedParentForSub(null);
    // Espandere automaticamente la relativa categoria per mostrare il risultato
    setExpandedCategoryId(parentIdToExpand);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <PageHeader
        icon={<Tags className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />}
        title="Categorie e Sottocategorie"
        subtitle="Consulta la gerarchia e le tassonomie predefinite per la classificazione di entrate e spese."
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => {
                setNewCatName('');
                setCatError('');
                setIsNewCatModalOpen(true);
              }}
            >
              Nuova Categoria
            </Button>
            <Link to={ROUTES.SETTINGS}>
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft className="w-4 h-4" />}
              >
                Torna a Impostazioni
              </Button>
            </Link>
          </div>
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
        <span className="text-slate-800 dark:text-slate-200 font-semibold">Categorie</span>
      </div>

      {/* Search & Filter Bar */}
      <DashboardCard>
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cerca categorie o sottocategorie..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full text-sm pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setSelectedTab('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  selectedTab === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Tutte ({parentCategories.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('expense')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  selectedTab === 'expense'
                    ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                Spese
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('income')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  selectedTab === 'income'
                    ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Entrate
              </button>
            </div>
          </div>
        </div>
      </DashboardCard>

      {/* Categories Compact Accordion List */}
      <div className="space-y-3">
        {filteredParents.length === 0 ? (
          <DashboardCard>
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
              <FolderTree className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-medium">Nessuna categoria trovata per i criteri selezionati.</p>
            </div>
          </DashboardCard>
        ) : (
          filteredParents.map((parent) => {
            const subcats = subCategoriesByParent.get(parent.id) || [];
            const isExpense = parent.type === 'expense';
            const isExpanded = expandedCategoryId === parent.id;

            return (
              <div
                key={parent.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden transition-all"
              >
                {/* Accordion Header / Compact Row */}
                <button
                  id={`accordion-header-${parent.id}`}
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`accordion-panel-${parent.id}`}
                  onClick={() => toggleCategory(parent.id)}
                  className="w-full flex items-center justify-between p-4 text-left cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0 pr-2">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shrink-0 shadow-xs ${
                        isExpense ? 'bg-rose-500 dark:bg-rose-600' : 'bg-emerald-500 dark:bg-emerald-600'
                      }`}
                    >
                      {parent.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate leading-tight">
                        {parent.name}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {parent.name} · {subcats.length} {subcats.length === 1 ? 'sottocategoria' : 'sottocategorie'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <Badge variant={isExpense ? 'danger' : 'success'}>
                      {isExpense ? 'Spesa' : 'Entrata'}
                    </Badge>
                    <div className="p-1 rounded-lg text-slate-400 dark:text-slate-500">
                      <ChevronDown
                        className={`w-5 h-5 transition-transform duration-200 ${
                          isExpanded ? 'rotate-180 text-indigo-600 dark:text-indigo-400' : ''
                        }`}
                      />
                    </div>
                  </div>
                </button>

                {/* Expanded Accordion Panel */}
                {isExpanded && (
                  <div
                    id={`accordion-panel-${parent.id}`}
                    role="region"
                    aria-labelledby={`accordion-header-${parent.id}`}
                    className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Sottocategorie ({subcats.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedParentForSub(parent);
                          setNewSubName('');
                          setSubError('');
                        }}
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 cursor-pointer py-1 px-2.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Aggiungi Sottocategoria
                      </button>
                    </div>

                    {subcats.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic py-2">
                        Nessuna sottocategoria presente in questa categoria.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                        {subcats.map((sub) => (
                          <div
                            key={sub.id}
                            className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between text-xs"
                          >
                            <span className="font-semibold text-slate-700 dark:text-slate-300 truncate mr-2">
                              {sub.name}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isExpense ? 'bg-rose-400' : 'bg-emerald-400'
                              }`}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal Creazione Categoria */}
      <Modal
        isOpen={isNewCatModalOpen}
        onClose={() => setIsNewCatModalOpen(false)}
        title="Nuova Categoria"
        subtitle="Crea una nuova categoria principale per la classificazione."
      >
        <form onSubmit={handleCreateCategory} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nome Categoria *
            </label>
            <input
              type="text"
              required
              value={newCatName}
              onChange={(e) => {
                setNewCatName(e.target.value);
                if (catError) setCatError('');
              }}
              placeholder="es. Animali domestici"
              className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tipologia
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewCatType('expense')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                  newCatType === 'expense'
                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                Spesa
              </button>
              <button
                type="button"
                onClick={() => setNewCatType('income')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                  newCatType === 'income'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Entrata
              </button>
            </div>
          </div>

          {catError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{catError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsNewCatModalOpen(false)}
            >
              Annulla
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Crea Categoria
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Creazione Sottocategoria */}
      <Modal
        isOpen={Boolean(selectedParentForSub)}
        onClose={() => setSelectedParentForSub(null)}
        title={`Nuova Sottocategoria in "${selectedParentForSub?.name || ''}"`}
        subtitle="Aggiungi una voce specifica a questa categoria."
      >
        <form onSubmit={handleCreateSubcategory} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nome Sottocategoria *
            </label>
            <input
              type="text"
              required
              value={newSubName}
              onChange={(e) => {
                setNewSubName(e.target.value);
                if (subError) setSubError('');
              }}
              placeholder="es. Veterinario"
              className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {subError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{subError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedParentForSub(null)}
            >
              Annulla
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Salva Sottocategoria
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

