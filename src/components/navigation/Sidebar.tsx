import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  TrendingUp,
  TrendingDown,
  FolderKanban,
  FileText,
  Calendar,
  PiggyBank,
  Store,
  Paperclip,
  HardDrive,
  Settings,
} from 'lucide-react';
import { MAIN_NAVIGATION, SECONDARY_NAVIGATION } from '../../config/navigation.config';

export const Sidebar: React.FC = () => {
  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Home': return <Home className="w-5 h-5" />;
      case 'TrendingUp': return <TrendingUp className="w-5 h-5" />;
      case 'TrendingDown': return <TrendingDown className="w-5 h-5" />;
      case 'FolderKanban': return <FolderKanban className="w-5 h-5" />;
      case 'FileText': return <FileText className="w-5 h-5" />;
      case 'Calendar': return <Calendar className="w-5 h-5" />;
      case 'PiggyBank': return <PiggyBank className="w-5 h-5" />;
      case 'Store': return <Store className="w-5 h-5" />;
      case 'Paperclip': return <Paperclip className="w-5 h-5" />;
      case 'HardDrive': return <HardDrive className="w-5 h-5" />;
      case 'Settings': return <Settings className="w-5 h-5" />;
      default: return <Home className="w-5 h-5" />;
    }
  };

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 bg-white min-h-[calc(100vh-65px)] p-4 shadow-xs">
      <div className="mb-6">
        <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Principale</p>
        <div className="space-y-1">
          {MAIN_NAVIGATION.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 font-semibold shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {getIcon(item.iconName)}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div>
        <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Secondaria</p>
        <div className="space-y-1">
          {SECONDARY_NAVIGATION.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-600 font-semibold shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {getIcon(item.iconName)}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </aside>
  );
};

