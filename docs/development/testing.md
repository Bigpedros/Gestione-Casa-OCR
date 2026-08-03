# Strategia di Testing

I test sono gestiti tramite **Vitest** e **Testing Library**:

- **Business Logic Tests**:
  - Calcolo bilancio prudenziale
  - Accumulo Extra Budget da surplus
  - Copertura deficit con Extra Budget
  - Divieto utilizzo Extra Budget per progetti o spese volontarie
  - Limite massimo di 3 progetti attivi e 3 contributori
  - Seed categorie idempotente
  - Import / Export Backup
