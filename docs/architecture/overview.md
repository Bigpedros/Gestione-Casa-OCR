# Architettura di Gestione Casa

## Panoramica dei Livelli

L'applicazione **Gestione Casa** segue un'architettura **Local-First** rigorosamente modulare e stratificata per garantire separazione delle responsabilità, manutenibilità e testabilità.

### 1. Livello UI (Presentazione)
- **Componenti React**: Pagine e componenti visuali organizzati per feature (`src/features/*`).
- **React Router**: Gestione delle rotte applicative e della navigazione.
- **Form e Validazione**: `react-hook-form` con risolutori Zod (`@hookform/resolvers/zod`).
- **Stile**: Tailwind CSS mobile-first accessibile.

### 2. Livello Feature (`src/features/*`)
Ogni modulo applicativo (Home, Entrate, Uscite, Progetti, Report, Spese Fisse, Risparmi, Fornitori, Allegati, Backup, Impostazioni) è isolato con:
- Pagina principale e sotto-componenti
- Tipi specifici e schemi Zod
- Hook React per l'integrazione reattiva con i Service

### 3. Livello Hook & State (`src/hooks/*`)
- Utilizza `dexie-react-hooks` (`useLiveQuery`) per reattività istantanea ai cambiamenti nel database IndexedDB.
- Gestisce lo stato locale leggero tramite React Context (es. impostazioni, tema, toast feedback).

### 4. Livello Service (`src/services/*`)
- Contiene tutta la **logica di business vincolante**: calcolo budget prudenziale, accumulo ed erogazione Extra Budget, avanzamento progetti, report e seed dati.
- Nessuna chiamata diretta al DB dai componenti UI.

### 5. Livello Repository (`src/repositories/*`)
- Astrae le operazioni sul database IndexedDB/Dexie.
- Fornisce metodi CRUD e query tipizzate per entità.

### 6. Livello Database (`src/database/*`)
- Istanza Dexie (`db.ts`) orientata al DB `gestioneCasa`.
- Schema tipizzato con versione 2.0.0 e supporto per migrazioni.
- Script di seed idempotente per le categorie iniziali.

### 7. Livello Validazione (`src/schemas/*` e `src/types/*`)
- Tipi TypeScript rigidi e schemi di validazione runtime Zod.
- Garantisce che importi non siano negativi, date siano in ISO e mesi in `YYYY-MM`.
