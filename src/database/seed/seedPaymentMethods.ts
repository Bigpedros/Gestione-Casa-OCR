import { db } from '../db';
import type { PaymentMethodDefinition } from '../../types';

export const INITIAL_PAYMENT_METHODS: Array<Omit<PaymentMethodDefinition, 'id' | 'metadata'>> = [
  {
    code: 'cash',
    displayName: 'Contanti',
    macroCategory: 'cash',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['contanti', 'contante', 'cash', 'eur', 'contant'],
  },
  {
    code: 'debit_card',
    displayName: 'Carta di debito',
    macroCategory: 'debitCard',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['bancomat', 'debito', 'debit card', 'pagobancomat', 'maestro', 'vpay', 'deb'],
  },
  {
    code: 'credit_card',
    displayName: 'Carta di credito',
    macroCategory: 'creditCard',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['carta', 'carta di credito', 'credit card', 'visa', 'mastercard', 'amex', 'american express', 'cred'],
  },
  {
    code: 'bank_transfer',
    displayName: 'Bonifico',
    macroCategory: 'bankTransfer',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['bonifico', 'bonifico bancario', 'sepa', 'wire transfer', 'trf', 'bon'],
  },
  {
    code: 'direct_debit',
    displayName: 'Addebito diretto',
    macroCategory: 'directDebit',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['addebito diretto', 'rid', 'sdd', 'direct debit', 'domiciliazione'],
  },
  {
    code: 'digital_wallet',
    displayName: 'Wallet digitale',
    macroCategory: 'digitalWallet',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['wallet', 'paypal', 'apple pay', 'google pay', 'satispay', 'digital wallet'],
  },
  {
    code: 'other_electronic',
    displayName: 'Altro pagamento elettronico',
    macroCategory: 'other',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['pos', 'pagopa', 'sisal', 'mooney', 'elettronico', 'electronic'],
  },
  {
    code: 'crypto_custom',
    displayName: 'Criptovaluta / Altro',
    macroCategory: 'other',
    isSystem: true,
    enabled: true,
    customTickerOrName: null,
    aliases: ['crypto', 'cripto', 'criptovaluta', 'token'],
  },
];

let seedPaymentMethodsPromise: Promise<void> | null = null;

export function seedInitialPaymentMethods(): Promise<void> {
  if (seedPaymentMethodsPromise) {
    return seedPaymentMethodsPromise;
  }
  seedPaymentMethodsPromise = performPaymentMethodsSeed().finally(() => {
    seedPaymentMethodsPromise = null;
  });
  return seedPaymentMethodsPromise;
}

async function performPaymentMethodsSeed(): Promise<void> {
  const now = new Date().toISOString();

  for (const methodData of INITIAL_PAYMENT_METHODS) {
    try {
      const fixedId = `pm-${methodData.code.replace(/_/g, '-')}`;
      let existing = await db.paymentMethods.get(fixedId);
      if (!existing) {
        existing = await db.paymentMethods.where('code').equals(methodData.code).first();
      }

      if (!existing) {
        const item: PaymentMethodDefinition = {
          id: fixedId,
          ...methodData,
          metadata: {
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
        };
        await db.paymentMethods.put(item);
      }
    } catch (err) {
      console.warn(`Avviso durante il seeding del metodo di pagamento ${methodData.code}:`, err);
    }
  }
}
