import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { supplierRepository } from '../../repositories';
import {
  PageHeader,
  EmptyState,
  Badge,
} from '../../components/common';
import { Store } from 'lucide-react';

export const SuppliersPage: React.FC = () => {
  const rawSuppliers = useLiveQuery(() => supplierRepository.getAll(), []);

  const suppliers = useMemo(() => {
    if (!rawSuppliers) return [];
    return [...rawSuppliers].sort((a, b) =>
      a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
    );
  }, [rawSuppliers]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <PageHeader
        icon={<Store className="w-6 h-6 text-indigo-600" />}
        title="Anagrafica Fornitori"
        subtitle="Gestisci supermercati, negozianti e fornitori di servizi."
      />

      {(!suppliers || suppliers.length === 0) ? (
        <EmptyState
          icon={<Store className="w-7 h-7 text-indigo-500" />}
          title="Nessun fornitore registrato"
          description="I fornitori verranno mostrati qui in ordine alfabetico."
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Nome Fornitore (Ord. Alfabetico A-Z)
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Stato
            </span>
          </div>
          <ul className="divide-y divide-slate-100 dark:border-slate-800 border-t-0">
            {suppliers.map((s) => (
              <li
                key={s.id}
                className="px-6 py-4 flex justify-between items-center hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white text-base">
                      {s.name}
                    </h3>
                    {s.aliases && s.aliases.length > 0 && (
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        Alias: {s.aliases.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <Badge variant={s.status === 'confirmed' ? 'success' : 'neutral'}>
                  {s.status === 'confirmed' ? 'Confermato' : s.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
