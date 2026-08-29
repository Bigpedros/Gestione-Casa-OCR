import { db } from '../db';
import type { Category } from '../../types';
import { seedInitialPaymentMethods } from './seedPaymentMethods';

export const INITIAL_CATEGORIES = [
  {
    name: 'Alimentazione',
    code: 'CAT_FOOD',
    subcategories: ['Supermercato', 'Panetteria', 'Macelleria', 'Frutta e verdura', 'Ristoranti e bar'],
  },
  {
    name: 'Casa',
    code: 'CAT_HOME',
    subcategories: ['Affitto o mutuo', 'Condominio', 'Utenze', 'Manutenzione', 'Arredamento', 'Pulizia'],
  },
  {
    name: 'Trasporti',
    code: 'CAT_TRANSPORT',
    subcategories: ['Carburante', 'Trasporto pubblico', 'Manutenzione veicolo', 'Assicurazione', 'Pedaggi e parcheggi'],
  },
  {
    name: 'Salute',
    code: 'CAT_HEALTH',
    subcategories: ['Farmaci', 'Visite mediche', 'Esami', 'Dentista', 'Occhiali e lenti'],
  },
  {
    name: 'Tecnologia',
    code: 'CAT_TECH',
    subcategories: ['Internet', 'Telefonia', 'Hardware', 'Software', 'Abbonamenti digitali'],
  },
  {
    name: 'Famiglia',
    code: 'CAT_FAMILY',
    subcategories: ['Scuola', 'Bambini', 'Abbigliamento', 'Tempo libero', 'Regali', 'Animali domestici'],
  },
  {
    name: 'Banca e finanza',
    code: 'CAT_FINANCE',
    subcategories: ['Commissioni bancarie', 'Imposte', 'Assicurazioni', 'Debiti', 'Interessi'],
  },
  {
    name: 'Progetti',
    code: 'CAT_PROJECTS',
    subcategories: ['Acquisti progetto', 'Quote progetto', 'Materiali', 'Servizi'],
  },
  {
    name: 'Utenze',
    code: 'CAT_UTILITIES',
    subcategories: ['Luce', 'Gas', 'Acqua', 'Rifiuti', 'Riscaldamento'],
  },
  {
    name: 'Abbonamenti',
    code: 'CAT_SUBSCRIPTIONS',
    subcategories: ['Streaming TV/Musica', 'Palestra e sport', 'Software e cloud', 'Giornali e riviste'],
  },
  {
    name: 'Varie',
    code: 'CAT_MISC',
    subcategories: ['Spese impreviste', 'Beneficenza', 'Altro'],
  },
];

let seedPromise: Promise<void> | null = null;

export function seedInitialCategoriesAndSettings(): Promise<void> {
  if (seedPromise) {
    return seedPromise;
  }
  seedPromise = performSeed().finally(() => {
    seedPromise = null;
  });
  return seedPromise;
}

async function performSeed(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Seed Default Settings safely
  try {
    const defaultSettingsId = 'default-settings';
    const existingSettings = await db.settings.get(defaultSettingsId);
    if (!existingSettings) {
      await db.settings.put({
        id: defaultSettingsId,
        userMode: 'family',
        contributorsCount: 1,
        currency: 'EUR',
        language: 'it-IT',
        budgetMode: 'prudential',
        monthlyBudgetSource: 'manualContributorIncome',
        includePaidExpensesInBudget: true,
        includeNotifiedPlannedExpensesInBudget: true,
        includeSavingPlansInBudget: true,
        includeProjectQuotasInBudget: true,
        extraBudgetUsage: 'coverDeficitOnly',
        reportClosingMode: 'automaticEndOfMonth',
        reportClosingTime: '23:59:59',
        attachmentRetentionMonths: 6,
        theme: 'pearl',
        notificationsEnabled: true,
        notificationAdvanceDays: 3,
        metadata: {
          createdAt: now,
          updatedAt: now,
          version: 1,
        },
      });
    }
  } catch (err) {
    console.warn('Avviso durante il seeding delle impostazioni:', err);
  }

  // 2. Seed Default Contributors safely
  try {
    const existingContrib1 = await db.contributors.get('contrib-1');
    if (!existingContrib1) {
      await db.contributors.bulkPut([
        {
          id: 'contrib-1',
          order: 1,
          name: 'Contributore 1',
          label: 'Stipendio 1',
          active: true,
          colorToken: '#4F46E5',
          metadata: { createdAt: now, updatedAt: now, version: 1 },
        },
      ]);
    }
  } catch (err) {
    console.warn('Avviso durante il seeding dei contributori:', err);
  }

  // 3. Seed Categories Idempotently
  for (let i = 0; i < INITIAL_CATEGORIES.length; i++) {
    const parentCatData = INITIAL_CATEGORIES[i];
    const parentId = `cat-parent-${parentCatData.code.toLowerCase()}`;

    try {
      let parentCategory = await db.categories.get(parentId);
      if (!parentCategory) {
        parentCategory = await db.categories.where('code').equals(parentCatData.code).first();
      }

      if (!parentCategory) {
        parentCategory = {
          id: parentId,
          parentId: null,
          name: parentCatData.name,
          code: parentCatData.code,
          type: 'expense',
          level: 1,
          enabled: true,
          system: true,
          sortOrder: i + 1,
          metadata: { createdAt: now, updatedAt: now, version: 1 },
        };
        await db.categories.put(parentCategory);
      }

      for (let j = 0; j < parentCatData.subcategories.length; j++) {
        const subName = parentCatData.subcategories[j];
        const subCode = `${parentCatData.code}_SUB_${j + 1}`;
        const subId = `cat-sub-${subCode.toLowerCase()}`;

        let existingSub = await db.categories.get(subId);
        if (!existingSub) {
          existingSub = await db.categories.where('code').equals(subCode).first();
        }

        if (!existingSub) {
          const subCategory: Category = {
            id: subId,
            parentId: parentCategory.id,
            name: subName,
            code: subCode,
            type: 'expense',
            level: 2,
            enabled: true,
            system: true,
            sortOrder: j + 1,
            metadata: { createdAt: now, updatedAt: now, version: 1 },
          };
          await db.categories.put(subCategory);
        }
      }
    } catch (err) {
      console.warn(`Avviso durante il seeding della categoria ${parentCatData.code}:`, err);
    }
  }

  // 4. Seed Payment Methods safely
  try {
    await seedInitialPaymentMethods();
  } catch (err) {
    console.warn('Avviso durante il seeding dei metodi di pagamento:', err);
  }

  // 5. Run automatic month closing repair and expired check safely
  try {
    const { runMonthClosingCheck } = await import('../../services/monthClosingService');
    await runMonthClosingCheck();
  } catch (err) {
    console.warn('Avviso durante il controllo della chiusura mensile:', err);
  }
}
