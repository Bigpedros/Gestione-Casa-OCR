# GUIDA ALL'ACCESSIBILITÀ - GESTIONE CASA

### Standard WCAG 2.1 AA Compliance
1. **Contrasto Cromatico**:
   - Testo principale (`#0F172A`) su Sfondo (`#FFFFFF` / `#F8FAFC`): Contrasto > 14:1 (eccede lo standard 4.5:1).
   - Testo secondario (`#64748B`) su Sfondo (`#FFFFFF`): Contrasto > 4.8:1.
   - Pulsante primario Viola (`#4F46E5`) con testo Bianco (`#FFFFFF`): Contrasto > 5.2:1.

2. **Dimensione Target di Tocco**:
   - Pulsanti e icone interattive hanno una dimensione minima di **44x44px** per l'uso su dispositivi touch.

3. **Navigazione da Tastiera & Focus Indicator**:
   - Focus outline visibile a contrasto elevato (`ring-2 ring-indigo-500 ring-offset-2`).

4. **Screen Reader e ARIA**:
   - Tutti i grafici e le card contenenti metriche hanno attributi `aria-label` descrittivi.
   - La Bottom Navigation e l'Header utilizzano tag semantici (`<nav>`, `<header>`, `<main>`, `<section>`).
