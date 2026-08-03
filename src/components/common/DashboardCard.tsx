import React from 'react';

interface DashboardCardProps {
  title?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: 'normal' | 'compact' | 'spacious';
}

export const DashboardCard: React.FC<DashboardCardProps> = ({
  title,
  subtitle,
  badge,
  action,
  children,
  className = '',
  padding = 'normal',
}) => {
  const paddingClass =
    padding === 'compact' ? 'p-4' : padding === 'spacious' ? 'p-6' : 'p-5';

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs ${paddingClass} ${className}`}
    >
      {(title || action || badge) && (
        <div className="flex items-center justify-between mb-4 gap-2">
          <div>
            <div className="flex items-center gap-2">
              {title && <h3 className="font-bold text-slate-900 dark:text-white text-base">{title}</h3>}
              {badge}
            </div>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
