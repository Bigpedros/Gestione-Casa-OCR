# Regole di Business Vincolanti

Il sistema **Gestione Casa** applica in modo rigoroso le seguenti regole di business per il calcolo economico domestico:

1. **Budget Mensile e Fonti**:
   - Il budget deriva dalle entrate inserite manualmente per i contributori attivi (max 3 contributori).

2. **Budget Prudenziale**:
   - `Bilancio Prudenziale = Entrate Incassate - Spese Pagate - Spese Pianificate Notificate - Quote Risparmio - Quote Progetti`.

3. **Extra Budget**:
   - L'eventuale **surplus** mensile positivo confluisce e si accumula nell'**Extra Budget**.
   - Viene riportato ai mesi successivi.
   - Può essere utilizzato **esclusivamente per coprire deficit futuri** (quando il bilancio prudenziale è negativo).
   - Viene prelevato soltanto l'importo strettamente necessario (`min(availableExtraBudget, abs(deficit))`).
   - **NON** può mai finanziare progetti.
   - **NON** può mai finanziare spese volontarie.
   - Se l'Extra Budget non basta, il deficit residuo viene riportato come scoperto non coperto.

4. **Classificazione Spese**:
   - Indipendente dalla categoria merceologica.
   - Valori: `necessary` (necessaria), `voluntary` (volontaria), `toEvaluate` (da valutare).

5. **Stati delle Entità**:
   - Spese: `draft`, `planned`, `paid`, `cancelled`.
   - Progetti: `active`, `completed`, `cancelled` (max 3 progetti attivi).
   - Risparmi: `active`, `completed`, `suspended`, `cancelled`.
   - Report: `provisional`, `final`.
   - Extra Budget: `accumulated`, `used`, `exhausted`.

6. **Progetti e Spese**:
   - Un acquisto per un progetto genera una spesa collegata con `entryMode: 'projectPurchase'`.
