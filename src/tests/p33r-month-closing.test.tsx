import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { db } from '../database/db';
import { reportRepository } from '../repositories';
import {
  getAutomaticClosingDate,
  repairPrematurelyClosedMonths,
  closeExpiredMonths,
  getClosingInfoText,
} from '../services/monthClosingService';
import { ReportsPage } from '../features/reports/ReportsPage';

describe('P-33R: Servizio di chiusura automatica e ripristino del mese corrente', () => {
  beforeEach(async () => {
    await db.monthlyReports.clear();
  });

  describe('1. Calcolo data di chiusura automatica (getAutomaticClosingDate)', () => {
    it('Calcola correttamente la data di chiusura per agosto 2026 -> 1° settembre 2026 ore 00:00', () => {
      const date = getAutomaticClosingDate(2026, 8);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(8); // 8 is September in JS Date
      expect(date.getDate()).toBe(1);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
      expect(date.getSeconds()).toBe(0);
    });

    it('Gestisce il passaggio di anno per dicembre 2026 -> 1° gennaio 2027 ore 00:00', () => {
      const date = getAutomaticClosingDate(2026, 12);
      expect(date.getFullYear()).toBe(2027);
      expect(date.getMonth()).toBe(0); // 0 is January in JS Date
      expect(date.getDate()).toBe(1);
    });
  });

  describe('2. Funzione di riparazione (repairPrematurelyClosedMonths)', () => {
    it('Ripristina il mese di Agosto 2026 (o mese futuro) da Definitivo a Provvisorio', async () => {
      // Seed a prematurely closed report for August 2026 (current date assumed Aug 2026)
      await reportRepository.save({
        year: 2026,
        month: 8,
        status: 'final',
        closedAt: new Date().toISOString(),
        totalIncome: 2000,
        paidExpenses: 1000,
        plannedNotifiedExpenses: 0,
        savingPlanTotal: 200,
        projectQuotaTotal: 100,
        prudentialBalance: 700,
        extraBudgetOpening: 0,
        extraBudgetUsed: 0,
        extraBudgetClosing: 0,
        uncoveredDeficit: 0,
        contributorSummaries: [],
        categorySummaries: [],
        classificationSummaries: { necessary: 1000, voluntary: 0, toEvaluate: 0 },
        projectSummaries: [],
        generatedAt: new Date().toISOString(),
      });

      const initial = await reportRepository.getByMonthYear(2026, 8);
      expect(initial?.status).toBe('final');
      expect(initial?.closedAt).not.toBeNull();

      const repairedCount = await repairPrematurelyClosedMonths();
      expect(repairedCount).toBeGreaterThanOrEqual(1);

      const repaired = await reportRepository.getByMonthYear(2026, 8);
      expect(repaired?.status).toBe('provisional');
      expect(repaired?.closedAt).toBeNull();
      // Verificare che i dati economici rimangano inalterati
      expect(repaired?.totalIncome).toBe(2000);
      expect(repaired?.paidExpenses).toBe(1000);
    });

    it('Non modifica report legittimamente chiusi del passato (es. Luglio 2025)', async () => {
      await reportRepository.save({
        year: 2025,
        month: 7,
        status: 'final',
        closedAt: '2025-08-01T00:00:00.000Z',
        totalIncome: 1500,
        paidExpenses: 800,
        plannedNotifiedExpenses: 0,
        savingPlanTotal: 100,
        projectQuotaTotal: 0,
        prudentialBalance: 600,
        extraBudgetOpening: 0,
        extraBudgetUsed: 0,
        extraBudgetClosing: 0,
        uncoveredDeficit: 0,
        contributorSummaries: [],
        categorySummaries: [],
        classificationSummaries: { necessary: 800, voluntary: 0, toEvaluate: 0 },
        projectSummaries: [],
        generatedAt: '2025-08-01T00:00:00.000Z',
      });

      const repairedCount = await repairPrematurelyClosedMonths();
      expect(repairedCount).toBe(0);

      const pastReport = await reportRepository.getByMonthYear(2025, 7);
      expect(pastReport?.status).toBe('final');
    });

    it('Chiude i mesi scaduti rimasti in stato provvisorio (es. Luglio 2025)', async () => {
      await reportRepository.save({
        year: 2025,
        month: 7,
        status: 'provisional',
        closedAt: null,
        totalIncome: 1500,
        paidExpenses: 800,
        plannedNotifiedExpenses: 0,
        savingPlanTotal: 100,
        projectQuotaTotal: 0,
        prudentialBalance: 600,
        extraBudgetOpening: 0,
        extraBudgetUsed: 0,
        extraBudgetClosing: 0,
        uncoveredDeficit: 0,
        contributorSummaries: [],
        categorySummaries: [],
        classificationSummaries: { necessary: 800, voluntary: 0, toEvaluate: 0 },
        projectSummaries: [],
        generatedAt: '2025-07-15T00:00:00.000Z',
      });

      const closedCount = await closeExpiredMonths();
      expect(closedCount).toBe(1);

      const closedReport = await reportRepository.getByMonthYear(2025, 7);
      expect(closedReport?.status).toBe('final');
      expect(closedReport?.closedAt).not.toBeNull();
    });
  });

  describe('3. Testo informativo (getClosingInfoText)', () => {
    it('Fornisce le stringhe corrette per mese corrente non ancora scaduto', () => {
      const text = getClosingInfoText(2026, 8, true, 'provisional');
      expect(text.mainText).toBe('Il mese viene chiuso automaticamente alla sua scadenza.');
      expect(text.subText).toContain('Chiusura automatica prevista il 1° settembre 2026 alle 00:00.');
    });

    it('Fornisce le stringhe corrette per intervalli di più mesi', () => {
      const text = getClosingInfoText(2026, 8, false, 'provisional');
      expect(text.mainText).toBe('Il mese viene chiuso automaticamente alla sua scadenza.');
      expect(text.subText).toBe('I singoli mesi vengono chiusi automaticamente alla rispettiva scadenza.');
    });
  });

  describe('4. Render UI di ReportsPage', () => {
    it('Rende il pulsante "Chiudi Mese" disabilitato e mostra il banner informativo', async () => {
      render(<ReportsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Chiudi Mese/i })).toBeInTheDocument();
      });

      const closeBtn = screen.getByRole('button', { name: /Chiudi Mese/i });
      expect(closeBtn).toBeDisabled();
      expect(closeBtn).toHaveAttribute('aria-disabled', 'true');

      await waitFor(() => {
        expect(
          screen.getByText('Il mese viene chiuso automaticamente alla sua scadenza.')
        ).toBeInTheDocument();
      });
    });
  });
});
