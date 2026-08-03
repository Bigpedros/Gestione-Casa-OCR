# Struttura Database IndexedDB (gestioneCasa)

Il database è gestito tramite Dexie.js.

- **Nome DB**: `gestioneCasa`
- **Versione Schema**: `2` (2.0.0)

## Tabelle e Indici
- `settings`: `id, userMode`
- `contributors`: `id, order, active, [order+active]`
- `incomeEntries`: `id, contributorId, incomeDate, type, status, competenceYear, competenceMonth, [competenceYear+competenceMonth], [contributorId+competenceYear+competenceMonth]`
- `expenses`: `id, expenseDate, paymentDate, status, entryMode, supplierId, projectId, fixedExpenseId, categoryId, subcategoryId, classification, notified, competenceYear, competenceMonth, [competenceYear+competenceMonth], [status+notified], [categoryId+subcategoryId]`
- `expenseItems`: `id, expenseId, categoryId, subcategoryId, classification, [expenseId+classification]`
- `categories`: `id, code, parentId, type, level, enabled, [type+level], [parentId+sortOrder]`
- `suppliers`: `id, name, status, defaultCategoryId`
- `fixedExpenses`: `id, status, frequency, dueDay, categoryId, priority, [status+dueDay]`
- `fixedExpenseOccurrences`: `id, fixedExpenseId, expenseId, dueDate, status, notified, competenceYear, competenceMonth, [competenceYear+competenceMonth], [status+dueDate]`
- `savingPlans`: `id, fixedExpenseId, projectId, status, targetDate`
- `savingMovements`: `id, savingPlanId, movementDate, type`
- `projects`: `id, slot, status, targetDate, [status+slot]`
- `projectMovements`: `id, projectId, movementDate, type`
- `attachments`: `id, entityType, entityId, status, deleteAfter, fileHash, [entityType+entityId], [status+deleteAfter]`
- `ocrProcesses`: `id, attachmentId, status, confirmedByUser`
- `monthlyReports`: `id, year, month, status, [year+month]`
- `extraBudgetMovements`: `id, movementDate, type, year, month, [year+month]`
- `auditLogs`: `id, entityType, entityId, action, timestamp, [entityType+entityId]`
