# Prompt Migrazione Database Dexie

Quando si aggiorna lo schema Dexie in `src/database/db.ts`:
1. Incrementare la versione di Dexie (`db.version(N)`).
2. Definire i nuovi indici senza rimuovere le chiavi primarie esistenti.
3. Aggiungere la funzione `.upgrade(tx => ...)` se si trasformano dati esistenti.
4. Aggiornare le interfacce TypeScript corrispondenti.
