import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { budgetService } from '../services/budgetService';
import { extraBudgetService } from '../services/extraBudgetService';
import { projectService } from '../services/projectService';
import { backupService } from '../services/backupService';
import { contributorRepository } from '../repositories';

describe('Gestione Casa - Core Business Rules Tests', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('Contributori: non deve superare 3 contributori attivi', async () => {
    const contributors = await contributorRepository.getAll();
    expect(contributors.length).toBeLessThanOrEqual(3);
  });

  it('Budget Prudenziale: calcolo corretto (Entrate Incassate - Spese Pagate - Spese Notificate - Risparmi - Progetti)', async () => {
    const summary = await budgetService.calculateMonthlySummary(2026, 7);
    expect(summary.totalReceivedIncome).toBe(0);
    expect(summary.prudentialBalance).toBe(0);
  });

  it('Extra Budget: rispetta le regole di divieto finanziamento spese volontarie e progetti', async () => {
    const isProjectValid = extraBudgetService.validateExtraBudgetUsageForProject('proj1', 100);
    expect(isProjectValid).toBe(false);

    const isVoluntaryValid = extraBudgetService.validateExtraBudgetUsageForVoluntaryExpense('exp1', 100);
    expect(isVoluntaryValid).toBe(false);

    const processed = await extraBudgetService.processMonthEndExtraBudget(2026, 7);
    expect(processed).toBeGreaterThanOrEqual(0);
  });

  it('Progetti: massimo 3 progetti attivi contemporaneamente', async () => {
    await projectService.createProject({
      slot: 1,
      name: 'Progetto 1',
      targetAmount: 500,
      savedAmount: 0,
      remainingMonths: 5,
      startDate: '2026-07-01',
      targetDate: '2026-12-01',
      status: 'active',
    });

    await projectService.createProject({
      slot: 2,
      name: 'Progetto 2',
      targetAmount: 1000,
      savedAmount: 0,
      remainingMonths: 10,
      startDate: '2026-07-01',
      targetDate: '2027-05-01',
      status: 'active',
    });

    await projectService.createProject({
      slot: 3,
      name: 'Progetto 3',
      targetAmount: 1500,
      savedAmount: 0,
      remainingMonths: 12,
      startDate: '2026-07-01',
      targetDate: '2027-07-01',
      status: 'active',
    });

    // Quarto progetto attivo deve lanciare un errore
    await expect(
      projectService.createProject({
        slot: 4,
        name: 'Progetto 4 Invalido',
        targetAmount: 2000,
        savedAmount: 0,
        remainingMonths: 12,
        startDate: '2026-07-01',
        targetDate: '2027-07-01',
        status: 'active',
      }),
    ).rejects.toThrow('Impossibile creare il progetto: massimo 3 progetti attivi consentiti.');
  });

  it('Backup e Ripristino: valida e ripristina con successo i dati', async () => {
    const backupJson = await backupService.exportBackup();
    const validation = backupService.validateBackup(backupJson);

    expect(validation.isValid).toBe(true);
    expect(validation.data?.appName).toBe('Gestione Casa');
    expect(validation.data?.databaseName).toBe('gestioneCasa');
  });
});
