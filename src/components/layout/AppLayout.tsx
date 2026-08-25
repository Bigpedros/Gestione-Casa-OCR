import React, { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Header } from '../navigation/Header';
import { Sidebar } from '../navigation/Sidebar';
import { BottomNav } from '../navigation/BottomNav';
import { PWAReloadPrompt } from '../common/PWAReloadPrompt';
import { SECONDARY_NAVIGATION } from '../../config/navigation.config';
import { useSeedData } from '../../hooks/useSeedData';
import {
  Calendar,
  PiggyBank,
  Store,
  Paperclip,
  HardDrive,
  Settings,
  X,
  Loader2,
} from 'lucide-react';

import { ErrorBoundary } from '../common/ErrorBoundary';

export const AppLayout: React.FC = () => {
  const { isSeeded } = useSeedData();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const location = useLocation();

  // Secondary workflows (Gabbia B): 12 destination pages (all subpaths of /settings/* plus /backup, /attachments, /suppliers)
  // The main /settings hub and core pages retain the primary desktop sidebar.
  const isSecondaryWorkflow =
    (location.pathname.startsWith('/settings/') && location.pathname !== '/settings') ||
    location.pathname === '/backup' ||
    location.pathname === '/attachments' ||
    location.pathname === '/suppliers';

  const getSecondaryIcon = (iconName: string) => {
    switch (iconName) {
      case 'Calendar': return <Calendar className="w-5 h-5" />;
      case 'PiggyBank': return <PiggyBank className="w-5 h-5" />;
      case 'Store': return <Store className="w-5 h-5" />;
      case 'Paperclip': return <Paperclip className="w-5 h-5" />;
      case 'HardDrive': return <HardDrive className="w-5 h-5" />;
      case 'Settings': return <Settings className="w-5 h-5" />;
      default: return <Settings className="w-5 h-5" />;
    }
  };

  if (!isSeeded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Inizializzazione database Gestione Casa...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <Header />
      {isSecondaryWorkflow ? (
        <div className="flex-1 w-full">
          <main className="max-w-4xl w-full mx-auto p-4 md:p-6 pb-24 md:pb-8">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      ) : (
        <div className="flex flex-1 max-w-7xl w-full mx-auto">
          <Sidebar />
          <main className="flex-1 p-4 md:p-6 pb-24 md:pb-8 max-w-full overflow-x-hidden">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      )}

      <BottomNav onOpenSecondaryNav={() => setIsMobileDrawerOpen(true)} />
      <PWAReloadPrompt />

      {/* Secondary Nav Drawer for Mobile */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs md:hidden">
          <div className="w-4/5 max-w-sm bg-white dark:bg-slate-900 h-full p-5 flex flex-col shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Altre Sezioni</h2>
              <button
                onClick={() => setIsMobileDrawerOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-1 flex-1 overflow-y-auto">
              {SECONDARY_NAVIGATION.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-xl font-medium text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`
                  }
                >
                  {getSecondaryIcon(item.iconName)}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
