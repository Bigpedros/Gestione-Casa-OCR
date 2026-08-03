import { db } from '../database/db';
import { contributorRepository, notificationRepository } from '../repositories';
import { emailNotificationService } from './emailNotificationService';

export const notificationScheduler = {
  synchronizeUpcomingDeadlines: async (): Promise<void> => {
    try {
      // 1. Fetch active contributors & suppliers
      const activeContributors = await contributorRepository.getActive();
      const eligibleContributors = activeContributors.filter(
        (c) => c.active && c.receiveDeadlineEmails && c.email && c.email.trim().length > 0
      );

      const suppliers = await db.suppliers.toArray();
      const supplierMap = new Map<string, string>();
      suppliers.forEach((s) => supplierMap.set(s.id, s.name));

      // 2. Fetch all expenses not paid or cancelled
      const allExpenses = await db.expenses.toArray();
      const unpaidExpenses = allExpenses.filter((e) => {
        const s = (e.status || '').toLowerCase();
        return s !== 'paid' && s !== 'cancelled' && s !== 'canceled' && s !== 'deleted' && s !== 'inactive';
      });

      // 3. Clean up unread notifications for expenses that are now paid/cancelled
      const paidOrCancelledExpenseIds = new Set(
        allExpenses
          .filter((e) => {
            const s = (e.status || '').toLowerCase();
            return s === 'paid' || s === 'cancelled' || s === 'canceled';
          })
          .map((e) => e.id)
      );

      if (paidOrCancelledExpenseIds.size > 0) {
        const unreadNotifications = await db.notifications.toArray();
        for (const notif of unreadNotifications) {
          if (notif.relatedEntityId && paidOrCancelledExpenseIds.has(notif.relatedEntityId) && !notif.read) {
            await notificationRepository.markAsRead(notif.id);
          }
        }
      }

      // 4. Check upcoming deadlines for 48h and 24h reminders
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const expense of unpaidExpenses) {
        const dueAt = expense.expenseDate;
        if (!dueAt || dueAt.length < 10) continue;

        const targetDate = new Date(`${dueAt.substring(0, 10)}T00:00:00`);
        if (isNaN(targetDate.getTime())) continue;

        const diffTime = targetDate.getTime() - today.getTime();
        const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

        const offsetsToCheck: Array<{ hours: 48 | 24; isDue: boolean }> = [
          { hours: 48, isDue: diffDays === 2 },
          { hours: 24, isDue: diffDays === 1 },
        ];

        for (const { hours, isDue } of offsetsToCheck) {
          if (!isDue) continue;

          const relatedType = expense.entryMode === 'fixedExpense' ? 'fixedExpense' : 'expense';
          const uniqueKey = `${relatedType}_${expense.id}_${dueAt}_${hours}h`;

          // Check idempotency
          const existing = await notificationRepository.findByUniqueKey(uniqueKey);
          if (existing) continue;

          // Determine recipient contributors
          const recipients = eligibleContributors.filter((c) =>
            hours === 48 ? c.receive48HourReminder : c.receive24HourReminder
          );

          const recipientEmails = recipients
            .map((c) => c.email?.trim())
            .filter((e): e is string => Boolean(e && e.length > 0));

          const supplierName = expense.supplierId ? supplierMap.get(expense.supplierId) || '' : '';
          const nameLabel = expense.description || supplierName || 'Spesa';
          const formattedAmount = `€${Number(expense.amount || 0).toFixed(2)}`;

          const title =
            hours === 48
              ? `Scadenza ${nameLabel} tra 48 ore`
              : `Scadenza ${nameLabel} domani`;

          const message =
            hours === 48
              ? `La spesa ${nameLabel} di ${formattedAmount} scade il ${dueAt}.`
              : `La spesa ${nameLabel} di ${formattedAmount} scade domani (${dueAt}).`;

          // Attempt email send (adapter returns provider_not_configured)
          const emailResult = await emailNotificationService.sendDeadlineReminder(
            { title, message, amount: expense.amount, dueAt },
            recipientEmails
          );

          // Save notification
          await notificationRepository.create({
            type: hours === 48 ? 'deadline_48h' : 'deadline_24h',
            title,
            message,
            createdAt: new Date().toISOString(),
            scheduledFor: new Date().toISOString(),
            dueAt,
            read: false,
            internalStatus: 'unread',
            emailStatus: emailResult.status,
            relatedEntityType: relatedType,
            relatedEntityId: expense.id,
            reminderOffsetHours: hours,
            uniqueKey,
            amount: Number(expense.amount || 0),
            supplierName,
            recipientContributorIds: recipients.map((c) => c.id),
            recipientEmails,
            sentAt: emailResult.status === 'sent' ? new Date().toISOString() : undefined,
            lastError: emailResult.status !== 'sent' ? emailResult.message : undefined,
          });
        }
      }
    } catch (err) {
      console.error('Errore durante la sincronizzazione delle notifiche:', err);
    }
  },
};
