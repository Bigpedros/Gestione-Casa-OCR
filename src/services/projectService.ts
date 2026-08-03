import { projectRepository, expenseRepository, categoryRepository } from '../repositories';
import type { Project, Expense } from '../types';

export const projectService = {
  calculateMonthlyQuota: (targetAmount: number, savedAmount: number, remainingMonths: number): number => {
    const needed = Math.max(0, targetAmount - savedAmount);
    const months = Math.max(1, remainingMonths);
    return Math.round((needed / months) * 100) / 100;
  },

  calculateProgressPercentage: (targetAmount: number, savedAmount: number): number => {
    if (targetAmount <= 0) return 0;
    return Math.min(100, Math.round((savedAmount / targetAmount) * 10000) / 100);
  },

  createProject: async (
    data: Omit<Project, 'id' | 'metadata' | 'monthlyQuota' | 'progressPercentage' | 'remainingMonths'> & {
      remainingMonths: number;
    },
  ): Promise<Project> => {
    const activeCount = await projectRepository.getActiveCount();
    if (data.status === 'active' && activeCount >= 3) {
      throw new Error('Impossibile creare il progetto: massimo 3 progetti attivi consentiti.');
    }

    const quota = projectService.calculateMonthlyQuota(data.targetAmount, data.savedAmount, data.remainingMonths);
    const progress = projectService.calculateProgressPercentage(data.targetAmount, data.savedAmount);

    return projectRepository.create({
      ...data,
      monthlyQuota: quota,
      progressPercentage: progress,
    });
  },

  createProjectPurchaseExpense: async (
    projectId: string,
    amount: number,
    description: string,
    expenseDate: string,
    paymentMethod: Expense['paymentMethod'] = 'debitCard',
  ): Promise<Expense> => {
    const categories = await categoryRepository.getAll();
    const projCategory = categories.find((c) => c.code === 'CAT_PROJECTS') || categories[0];
    const subCategories = await categoryRepository.getSubcategories(projCategory.id);
    const subCategory = subCategories[0] || projCategory;

    const [yearStr, monthStr] = expenseDate.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const expense = await expenseRepository.create({
      entryMode: 'projectPurchase',
      projectId,
      description: `Acquisto Progetto: ${description}`,
      amount,
      expenseDate,
      paymentDate: expenseDate,
      competenceMonth: month,
      competenceYear: year,
      categoryId: projCategory.id,
      subcategoryId: subCategory.id,
      paymentMethod,
      status: 'paid',
      classification: 'necessary',
      notified: true,
      recurring: false,
    });

    return expense;
  },
};
