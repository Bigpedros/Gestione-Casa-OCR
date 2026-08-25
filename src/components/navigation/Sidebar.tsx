import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  TrendingUp,
  TrendingDown,
  FolderKanban,
  FileText,
  Settings,
} from 'lucide-react';
import { MAIN_NAVIGATION } from '../../config/navigation.config';

export const Sidebar: React.FC = () => {
  const getIcon = (iconName: string, isActive: boolean, disabled?: boolean) => {
    const iconClass = `w-5 h-5 transition-colors shrink-0 ${
      disabled
        ? 'text-slate-400 dark:text-[#7E8793]'
        : isActive
        ? 'text-indigo-600 dark:text-[#4F46E5]'
        : 'text-slate-500 dark:text-[#A9B1BC] group-hover:text-slate-900 dark:group-hover:text-[#F2EDE2]'
    }`;
    switch (iconName) {
      case 'Home': return <Home className={iconClass} />;
      case 'TrendingUp': return <TrendingUp className={iconClass} />;
      case 'TrendingDown': return <TrendingDown className={iconClass} />;
      case 'FolderKanban': return <FolderKanban className={iconClass} />;
      case 'FileText': return <FileText className={iconClass} />;
      case 'Settings': return <Settings className={iconClass} />;
      default: return <Home className={iconClass} />;
    }
  };

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1C1F22] min-h-[calc(100vh-65px)] p-4 shadow-xs">
      <div className="space-y-1">
        {MAIN_NAVIGATION.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-[#E5DCCB] ${
                isActive
                  ? 'bg-indigo-50 text-indigo-600 dark:bg-[#E5DCCB] dark:text-[#4F46E5] font-semibold shadow-xs'
                  : 'text-slate-600 dark:text-[#CAC4B8] hover:bg-slate-50 dark:hover:bg-[#2D3238] hover:text-slate-900 dark:hover:text-[#F2EDE2]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {getIcon(item.iconName, isActive)}
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </aside>
  );
};


