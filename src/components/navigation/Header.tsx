import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bell } from 'lucide-react';
import { colors } from '../../design/colors';
import { notificationRepository } from '../../repositories';
import { notificationScheduler } from '../../services/notificationScheduler';
import { NotificationCenter } from './NotificationCenter';

export const Header: React.FC = () => {
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);

  const unreadCount = useLiveQuery(() => notificationRepository.getUnreadCount(), []);

  useEffect(() => {
    let isActive = true;
    async function syncDeadlines() {
      try {
        await notificationScheduler.synchronizeUpcomingDeadlines();
      } catch (err) {
        if (isActive) {
          console.error('Errore sincronizzazione scadenze:', err);
        }
      }
    }
    syncDeadlines();
    return () => {
      isActive = false;
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-3 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* House Logo - Blue roof, red walls, green chimney */}
            <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 p-1 flex items-center justify-center shrink-0 shadow-xs">
              <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 3L3 13V27C3 28.1 3.9 29 5 29H27C28.1 29 29 28.1 29 27V13L16 3Z" fill="#3B82F6" stroke="#2563EB" strokeWidth="1.5"/>
                <path d="M8 15V27H24V15H8Z" fill="#F43F5E" />
                <rect x="20" y="5" width="4" height="6" rx="1" fill="#10B981" />
                <path d="M13 21H19V29H13V21Z" fill="#3B82F6" />
                <circle cx="10" cy="18" r="2" fill="#FEF08A" />
                <circle cx="22" cy="18" r="2" fill="#FEF08A" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">Gestione Casa</h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                Tutto sotto controllo, casa e budget in equilibrio.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsNotificationCenterOpen((prev) => !prev)}
              className="relative p-2 rounded-xl text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Notifiche"
            >
              <Bell className="w-5 h-5" />
              {typeof unreadCount === 'number' && unreadCount > 0 && (
                <span
                  className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-xs"
                  style={{ backgroundColor: colors.semantic.expense }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <NotificationCenter
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
      />
    </>
  );
};

