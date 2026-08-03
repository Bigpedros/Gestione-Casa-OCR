import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Wallet, Plus, BarChart3, Settings } from 'lucide-react';
import { colors } from '../../design/colors';

interface BottomNavProps {
  onOpenSecondaryNav: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ onOpenSecondaryNav }) => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 shadow-lg">
      <div className="flex items-center justify-between max-w-md mx-auto relative">
        {/* Home */}
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-xl text-xs font-medium transition-colors ${
              isActive ? 'text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <Home className="w-5 h-5" />
          <span className="mt-1 text-[10px]">Home</span>
        </NavLink>

        {/* Entrate */}
        <NavLink
          to="/income"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-xl text-xs font-medium transition-colors ${
              isActive ? 'text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <Wallet className="w-5 h-5" />
          <span className="mt-1 text-[10px]">Entrate</span>
        </NavLink>

        {/* FAB Aggiungi (+) Button */}
        <div className="relative -top-5 flex flex-col items-center">
          <NavLink
            to="/expenses"
            className="w-12 h-12 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-transform"
            style={{ backgroundColor: colors.semantic.income }}
            aria-label="Aggiungi transazione"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </NavLink>
          <span className="text-[10px] font-medium text-slate-600 mt-0.5">Aggiungi</span>
        </div>

        {/* Report */}
        <NavLink
          to="/reports"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-xl text-xs font-medium transition-colors ${
              isActive ? 'text-rose-600 font-bold' : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <BarChart3 className="w-5 h-5 text-rose-500" />
          <span className="mt-1 text-[10px] text-rose-600 font-medium">Report</span>
        </NavLink>

        {/* Impostazioni / Altro */}
        <button
          onClick={onOpenSecondaryNav}
          className="flex flex-col items-center justify-center py-1 px-2 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-900"
          aria-label="Menu secondario"
        >
          <Settings className="w-5 h-5" />
          <span className="mt-1 text-[10px]">Altro</span>
        </button>
      </div>
    </nav>
  );
};

