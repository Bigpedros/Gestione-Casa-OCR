# FROZEN UI SPECIFICATION & DECLARATION

**Questa UI è congelata.**

Ogni modifica grafica deve essere compatibile con il Design System ufficiale estratto dalle schermate approvate (**Home** e **Report**).

È vietato introdurre componenti, layout, palette cromatiche, font o spaziature non presenti o non coerenti con il Design System senza preventiva approvazione.

---

### Principi Fondamentali
1. **Invariabilità Grafica**: Le schermate **Home** e **Report** della PWA *Gestione Casa* costituiscono la fonte visiva primaria dell'intera applicazione.
2. **Design System Unificato**: Ogni pagina nuova (Entrate, Uscite, Progetti, Spese Fisse, Risparmi, Fornitori, Allegati, Backup, Impostazioni) deve riutilizzare esclusivamente i Design Token definiti in `src/design/` e documentati in `docs/design/`.
3. **Zero Arbitrarietà**: Nessun margine, colore, raggio di curvatura, ombra o dimensione del testo può essere inserito ad hoc nel codice senza passare dai token centralizzati.
