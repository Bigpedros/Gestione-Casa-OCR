import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { contributorRepository, notificationRepository, expenseRepository } from '../repositories';
import { notificationScheduler } from '../services/notificationScheduler';
import { emailNotificationService } from '../services/emailNotificationService';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

describe('P-23R: Notifications & Contributor Email Integration', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await seedInitialCategoriesAndSettings();
  });

  it('1. Should calculate dynamic unread notifications count correctly', async () => {
    let unread = await notificationRepository.getUnreadCount();
    expect(unread).toBe(0);

    const notif1 = await notificationRepository.create({
      type: 'deadline_48h',
      title: 'Scadenza ACEA tra 48 ore',
      message: 'La bolletta ACEA di €45,00 scade tra 48 ore.',
      createdAt: new Date().toISOString(),
      scheduledFor: new Date().toISOString(),
      dueAt: '2026-08-15',
      read: false,
      internalStatus: 'unread',
      emailStatus: 'provider_not_configured',
      relatedEntityType: 'expense',
      relatedEntityId: 'exp-1',
      reminderOffsetHours: 48,
      uniqueKey: 'expense_exp-1_2026-08-15_48h',
      amount: 45.0,
      supplierName: 'ACEA',
    });

    unread = await notificationRepository.getUnreadCount();
    expect(unread).toBe(1);

    await notificationRepository.markAsRead(notif1.id);
    unread = await notificationRepository.getUnreadCount();
    expect(unread).toBe(0);
  });

  it('2. Contributor email and reminder preferences should be validated and persistent', async () => {
    const contributors = await contributorRepository.getAll();
    expect(contributors.length).toBeGreaterThan(0);

    const contrib = contributors[0];
    const updated = await contributorRepository.update(contrib.id, {
      email: 'mario.rossi@example.com',
      receiveDeadlineEmails: true,
      receive48HourReminder: true,
      receive24HourReminder: true,
      emailDeliveryStatus: 'provider_not_configured',
    });

    expect(updated.email).toBe('mario.rossi@example.com');
    expect(updated.receiveDeadlineEmails).toBe(true);
    expect(updated.receive48HourReminder).toBe(true);
    expect(updated.receive24HourReminder).toBe(true);

    const reloaded = await contributorRepository.getById(contrib.id);
    expect(reloaded?.email).toBe('mario.rossi@example.com');
  });

  it('3. Notification scheduler should generate 48h/24h reminders idempotently', async () => {
    const parents = await db.categories.where('level').equals(1).toArray();
    const cat = parents[0];

    // Get today's date formatted
    const today = new Date();
    const dueIn48h = new Date(today);
    dueIn48h.setDate(today.getDate() + 2);
    const dueAtStr = dueIn48h.toISOString().substring(0, 10);

    // Create an unpaid expense due in 2 days (48h)
    const expense = await expenseRepository.create({
      entryMode: 'manual',
      description: 'Bolletta Luce',
      amount: 85.0,
      expenseDate: dueAtStr,
      competenceYear: today.getFullYear(),
      competenceMonth: today.getMonth() + 1,
      categoryId: cat.id,
      subcategoryId: cat.id,
      paymentMethod: 'bankTransfer',
      status: 'planned',
      classification: 'necessary',
      notified: false,
    });

    // Run scheduler
    await notificationScheduler.synchronizeUpcomingDeadlines();

    const notifs = await notificationRepository.getAll();
    expect(notifs.length).toBe(1);
    expect(notifs[0].reminderOffsetHours).toBe(48);
    expect(notifs[0].relatedEntityId).toBe(expense.id);
    expect(notifs[0].emailStatus).toBe('provider_not_configured');

    // Run scheduler again (idempotency check)
    await notificationScheduler.synchronizeUpcomingDeadlines();
    const notifs2 = await notificationRepository.getAll();
    expect(notifs2.length).toBe(1); // No duplicates!
  });

  it('4. Email notification service should return provider_not_configured without fake claims', async () => {
    const result = await emailNotificationService.sendDeadlineReminder(
      { title: 'Test Scadenza' },
      ['test@example.com']
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('provider_not_configured');
    expect(result.message).toContain('Servizio e-mail non configurato');
  });

  it('5. markAllAsRead should set all notifications as read', async () => {
    await notificationRepository.create({
      type: 'deadline_48h',
      title: 'Notifica 1',
      message: 'Messaggio 1',
      createdAt: new Date().toISOString(),
      scheduledFor: new Date().toISOString(),
      dueAt: '2026-08-20',
      read: false,
      internalStatus: 'unread',
      emailStatus: 'provider_not_configured',
      relatedEntityType: 'expense',
      relatedEntityId: 'exp-101',
      reminderOffsetHours: 48,
      uniqueKey: 'exp_101_48h',
    });

    await notificationRepository.create({
      type: 'deadline_24h',
      title: 'Notifica 2',
      message: 'Messaggio 2',
      createdAt: new Date().toISOString(),
      scheduledFor: new Date().toISOString(),
      dueAt: '2026-08-21',
      read: false,
      internalStatus: 'unread',
      emailStatus: 'provider_not_configured',
      relatedEntityType: 'expense',
      relatedEntityId: 'exp-102',
      reminderOffsetHours: 24,
      uniqueKey: 'exp_102_24h',
    });

    let unreadCount = await notificationRepository.getUnreadCount();
    expect(unreadCount).toBe(2);

    await notificationRepository.markAllAsRead();

    unreadCount = await notificationRepository.getUnreadCount();
    expect(unreadCount).toBe(0);
  });
});
