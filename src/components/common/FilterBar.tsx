import React from 'react';
import { Filter } from 'lucide-react';

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
  label?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  children,
  className = '',
  label = 'Filtri:',
}) => {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-sm shadow-xs ${className}`}
    >
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 mr-1 select-none">
        <Filter className="w-4 h-4 text-indigo-500" />
        <span className="font-bold text-xs uppercase tracking-wider">{label}</span>
      </div>
      {children}
    </div>
  );
};
