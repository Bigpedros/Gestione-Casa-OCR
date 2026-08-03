import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { notificationRepository } from '../../repositories';
import {
  Bell,
  CheckCheck,
  Check,
  Trash2,
  X,
  Calendar,
  Tag,
  ArrowRight,
  Mail,
  AlertCircle,
} from 'lucide-react';
import type { AppNotification } from '../../types';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const notifications = useLiveQuery(() => notificationRepository.getAll(), []);

  if (!isOpen) return null;

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await notificationRepository.markAsRead(id);
  };

  const handleMarkAsUnread = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await notificationRepository.markAsUnread(id);
  };

  const handleMarkAllAsRead = async () => {
    await notificationRepository.markAllAsRead();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await notificationRepository.delete(id);
  };

  const handleOpenDetail = (notif: AppNotification) => {
    if (notif.relatedEntityType === 'expense' || notif.relatedEntityType === 'fixedExpense') {
      navigate('/expenses');
      onClose();
    }
  };

  const unreadCount = notifications ? notifications.filter((n) => !n.read).length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-base leading-tight">
                Centro Notifiche
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {unreadCount > 0 ? `${unreadCount} non lette` : 'Tutte le notifiche lette'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer"
                title="Segna tutte come lette"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Segna lette</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              aria-label="Chiudi"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!notifications || notifications.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <Bell className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              </div>
              <p className="font-semibold text-slate-700 dark:text-slate-300 text-base mb-1">
                Nessuna notifica
              </p>
              <p className="text-xs text-slate-500 max-w-xs">
                Non ci sono notifiche al momento. I promemoria di scadenza compariranno qui.
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-4 rounded-2xl border transition-all relative space-y-3 ${
                  !notif.read
                    ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800/60 shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80'
                }`}
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        notif.reminderOffsetHours === 48
                          ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                          : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      {notif.reminderOffsetHours ? `${notif.reminderOffsetHours}h prima` : 'Scadenza'}
                    </span>

                    {!notif.read && (
                      <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0" title="Non letta" />
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {!notif.read ? (
                      <button
                        type="button"
                        onClick={(e) => handleMarkAsRead(notif.id, e)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors cursor-pointer"
                        title="Segna come letta"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleMarkAsUnread(notif.id, e)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        title="Segna come non letta"
                      >
                        <CheckCheck className="w-4 h-4 text-emerald-600" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(notif.id, e)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                      title="Elimina notifica"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Title & Message */}
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                    {notif.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    {notif.message}
                  </p>
                </div>

                {/* Info row */}
                <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/60">
                  {notif.amount !== undefined && (
                    <span className="font-semibold text-slate-900 dark:text-white">
                      € {Number(notif.amount).toFixed(2)}
                    </span>
                  )}
                  {notif.dueAt && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      Scadenza: {notif.dueAt}
                    </span>
                  )}
                  {notif.supplierName && (
                    <span className="text-slate-500 font-medium">
                      Fornitore: {notif.supplierName}
                    </span>
                  )}
                </div>

                {/* Email Service Status Box */}
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-2.5 py-1.5 rounded-xl border border-slate-200/60 dark:border-slate-700/50">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Stato e-mail:</span>
                  <span className="text-amber-600 dark:text-amber-400 font-semibold inline-flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Servizio e-mail non configurato
                  </span>
                </div>

                {/* Link to Detail */}
                {notif.relatedEntityId && (
                  <button
                    type="button"
                    onClick={() => handleOpenDetail(notif)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer pt-0.5"
                  >
                    <span>Apri dettaglio movimento</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
