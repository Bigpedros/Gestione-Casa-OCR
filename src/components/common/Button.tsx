import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'emerald' | 'rose' | 'amber' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth = false,
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs rounded-lg gap-1.5',
    md: 'px-4 py-2.5 text-sm rounded-xl gap-2',
    lg: 'px-5 py-3 text-base rounded-2xl gap-2.5',
  };

  const variantClasses = {
    primary:
      'bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shadow-xs active:bg-indigo-800',
    secondary:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-300',
    danger:
      'bg-rose-600 text-white font-semibold hover:bg-rose-700 shadow-xs active:bg-rose-800',
    outline:
      'border border-slate-300 dark:border-slate-700 bg-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium',
    emerald:
      'bg-emerald-600 text-white font-semibold hover:bg-emerald-700 shadow-xs active:bg-emerald-800',
    rose:
      'bg-rose-600 text-white font-semibold hover:bg-rose-700 shadow-xs active:bg-rose-800',
    amber:
      'bg-amber-600 text-white font-semibold hover:bg-amber-700 shadow-xs active:bg-amber-800',
    ghost:
      'bg-transparent text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium',
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
        sizeClasses[size]
      } ${variantClasses[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
});

Button.displayName = 'Button';
