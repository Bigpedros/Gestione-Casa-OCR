import React from 'react';
import { FolderOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      className={`bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200 dark:border-slate-800 text-center space-y-3.5 shadow-xs ${className}`}
    >
      <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500">
        {icon || <FolderOpen className="w-7 h-7" />}
      </div>
      <div>
        <h4 className="font-bold text-slate-900 dark:text-white text-base">{title}</h4>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-2 flex justify-center">{action}</div>}
    </div>
  );
};
