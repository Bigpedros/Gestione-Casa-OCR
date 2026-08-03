# Gestione Casa — Progressive Web App (PWA)

**Gestione Casa** è un'applicazione web PWA local-first sviluppata per la gestione contabile ed economica integrata del nucleo familiare, con acquisizione e revisione OCR di scontrini e documenti.

## 📌 Caratteristiche Principali

- **Local-First & Offline Ready:** Funziona completamente offline nel browser. I dati risiedono esclusivamente nel dispositivo tramite **IndexedDB** (`Dexie.js`, database `gestioneCasaOCR`).
- **Nessuna dipendenza Cloud obbligatoria:** Funzionalità e persistenza prinicipali local-first sul dispositivo, senza registrazione o login richiesto.
- **Acquisizione & Revisione OCR Scontrini:**
  - Acquisizione OCR di scontrini e documenti di spesa.
  - Revisione obbligatoria dei dati estratti prima di qualsiasi contabilizzazione.
  - Confronto visuale affiancato tra documento originale ed i dati estratti dall'OCR.
  - Salvataggio progressivo della bozza revisionata.
  - Conferma esplicita dell'utente prima della contabilizzazione.
  - Nessuna creazione automatica di registrazioni contabili prima della conferma esplicita dell'utente.
  - Classificazione assistita di prodotti, categorie e righe OCR.
  - Controllo automatico delle discrepanze tra totale del documento e somma delle singole righe.
- **Budget Prudenziale Automazione:**
  - `Bilancio Prudenziale = Entrate Incassate Effettive - Spese Pagate - Spese Pianificate Notificate - Quote Risparmio - Quote Progetti`.
- **Extra Budget Riservato:**
  - Riservato unicamente alla copertura automatica di futuri deficit di cassa.
  - Non può essere alimentato arbitrariamente né finanziare spese volontarie o progetti.
- **Limite Progetti Attivi:** Massimo 3 progetti attivi contemporaneamente.
- **Nucleo Familiare:** Gestione fino a un massimo di 3 contributori.
- **Reportistica & Backup:** Generazione report mensili (provvisori e definitivi), esportazione PDF e backup/ripristino completo in formato JSON.

---

## 🏗️ Architettura del Software

L'architettura segue una struttura modulare e stratificata:

```text
src/
├── app/               # Configurazione router, provider e rotte
├── components/        # Componenti UI riutilizzabili e layout (Header, Sidebar, BottomNav)
├── config/            # Configurazione app, navigazione e feature flags
├── database/          # Configurazione Dexie (database gestioneCasaOCR) e seed dati
├── features/          # Pagine e moduli applicativi (Home, Income, Expenses, Attachments, Projects, Reports, ecc.)
├── hooks/             # Custom React Hooks
├── repositories/      # Strato Data Access (interfaccia diretta con Dexie)
├── schemas/           # Schemi di validazione Zod
├── services/          # Logica di business (Budget, Extra Budget, OCR Engine, OCR Parser, Product Classification, Reports, Backup)
├── types/             # Tipi e interfacce TypeScript
└── utils/             # Formattatori e utility
```

---

## 🛠️ Requisiti e Installazione

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Comandi Disponibili

```bash
# Avvio ambiente di sviluppo
npm run dev

# Verifica tipi TypeScript
npm run typecheck

# Linter ed ESLint
npm run lint

# Esecuzione test di unità e regole di business
npm run test

# Build di produzione
npm run build
```

---

## ⚖️ Licenza e Privacy
Sviluppato per uso personale e familiare. Rispetta la privacy al 100% conservando ogni dato in locale sul dispositivo dell'utente.
