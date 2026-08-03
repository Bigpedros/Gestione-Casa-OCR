import React from 'react';

interface PageHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  title,
  subtitle,
  badge,
  actions,
  className = '',
}) => {
  return (
    <div
      className={`bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${className}`}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          {icon && <div className="shrink-0">{icon}</div>}
          <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{title}</h2>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>

      {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
    </div>
  );
};
