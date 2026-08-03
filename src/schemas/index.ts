import { z } from 'zod';

export const MoneySchema = z
  .number({ required_error: 'Importo obbligatorio' })
  .min(0, 'L\'importo non può essere negativo')
  .transform((val) => Math.round(val * 100) / 100);

export const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD)');

export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato mese non valido (YYYY-MM)');

export const ExpenseClassificationSchema = z.enum(['necessary', 'voluntary', 'toEvaluate']);
export const ExpenseStatusSchema = z.enum(['draft', 'planned', 'paid', 'cancelled']);
export const IncomeStatusSchema = z.enum(['planned', 'received', 'skipped', 'cancelled']);
export const PrioritySchema = z.enum(['high', 'medium', 'low', 'none']);
export const PaymentMethodSchema = z.enum([
  'cash',
  'debitCard',
  'creditCard',
  'bankTransfer',
  'directDebit',
  'digitalWallet',
  'other',
]);

export const ContributorSchema = z.object({
  id: z.string().optional(),
  order: z.number().int().min(1).max(3, 'Massimo 3 contributori previsti'),
  name: z.string().min(1, 'Nome contributore obbligatorio').max(80),
  label: z.string().optional(),
  active: z.boolean().default(true),
  colorToken: z.string().nullable().optional(),
});

export const IncomeEntrySchema = z.object({
  id: z.string().optional(),
  contributorId: z.string().min(1, 'Seleziona un contributore'),
  type: z.string().min(1, 'Seleziona la tipologia di entrata'),
  description: z.string().max(250).optional().default(''),
  amount: MoneySchema,
  incomeDate: ISODateSchema,
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2200),
  frequency: z.enum(['once', 'weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual']),
  recurring: z.boolean().default(false),
  expectedDay: z.number().int().min(1).max(31).nullable().optional(),
  status: IncomeStatusSchema,
  notes: z.string().max(1000).optional().default(''),
});

export const ExpenseSchema = z.object({
  id: z.string().optional(),
  entryMode: z.enum(['manual', 'receipt', 'fixedExpense', 'projectPurchase']).default('manual'),
  supplierId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  fixedExpenseId: z.string().nullable().optional(),
  fixedExpenseOccurrenceId: z.string().nullable().optional(),
  description: z.string().max(250, 'Massimo 250 caratteri').default(''),
  amount: MoneySchema,
  expenseDate: ISODateSchema,
  paymentDate: ISODateSchema.nullable().optional(),
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2200),
  categoryId: z.string().min(1, 'Seleziona una categoria'),
  subcategoryId: z.string().min(1, 'Seleziona una sottocategoria'),
  paymentMethod: PaymentMethodSchema,
  status: ExpenseStatusSchema,
  classification: ExpenseClassificationSchema,
  notified: z.boolean().default(false),
  recurring: z.boolean().default(false),
  notes: z.string().max(1000).optional().default(''),
});

export const ProjectSchema = z.object({
  id: z.string().optional(),
  slot: z.number().int().min(1).max(3, 'Massimo 3 slot per i progetti'),
  name: z.string().min(1, 'Nome del progetto obbligatorio').max(150),
  description: z.string().max(1000).optional().default(''),
  targetAmount: MoneySchema,
  savedAmount: MoneySchema.default(0),
  monthlyQuota: MoneySchema.default(0),
  startDate: ISODateSchema,
  targetDate: ISODateSchema,
  status: z.enum(['active', 'completed', 'cancelled']),
});

export const FixedExpenseSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Nome spesa fissa obbligatorio').max(150),
  supplierId: z.string().nullable().optional(),
  categoryId: z.string().min(1, 'Seleziona una categoria'),
  subcategoryId: z.string().min(1, 'Seleziona una sottocategoria'),
  expectedAmount: MoneySchema,
  frequency: z.enum(['once', 'weekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual']),
  dueDay: z.number().int().min(1).max(31),
  durationMonths: z.number().int().min(1).optional().nullable(),
  startMonth: z.number().int().min(1).max(12).optional().nullable(),
  startYear: z.number().int().optional().nullable(),
  endMonth: z.number().int().min(1).max(12).optional().nullable(),
  endYear: z.number().int().optional().nullable(),
  priority: PrioritySchema,
  paymentMethod: PaymentMethodSchema,
  status: z.enum(['active', 'suspended', 'terminated']),
  generateAutomatically: z.boolean().default(true),
  monthlyProvisioningEnabled: z.boolean().default(false),
});

export const SavingPlanSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Nome piano risparmio obbligatorio').max(150),
  targetAmount: MoneySchema,
  currentAmount: MoneySchema.default(0),
  monthlyQuota: MoneySchema.default(0),
  startDate: ISODateSchema,
  targetDate: ISODateSchema,
  status: z.enum(['active', 'completed', 'suspended', 'cancelled']),
});

export const SupplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Nome fornitore obbligatorio').max(150),
  aliases: z.array(z.string()).default([]),
  defaultCategoryId: z.string().nullable().optional(),
  defaultSubcategoryId: z.string().nullable().optional(),
  taxCodeOrVatNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  status: z.enum(['new', 'confirmed', 'merged']).default('new'),
  notes: z.string().max(500).optional().default(''),
});
