# Stato Operativo Corrente — Gestione-Casa-OCR

* **Operazione:** `2.6.C2-E1`
* **Stato Operativo:** `VERIFIED_PASS`
* **Data Completamento:** 17 Agosto 2026
* **Istanza:** `Gestione-Casa-OCR`
* **Repository:** `Bigpedros/Gestione-Casa-OCR`
* **Branch:** `main`
* **Ultimo Commit Certificato:** `0f7da44`
* **Sincronizzazione GitHub:** `PENDING` (da effettuare prima di C2-E2)

---

## 1. File Modificati nella Fase 2.6.C2-E1
1. `.github/workflows/ci.yml` — Aggiornamento pipeline CI:
   * `actions/checkout@v5` (aggiornato da v4);
   * `actions/setup-node@v5` (aggiornato da v4);
   * `node-version: 22` (aggiornato da 20 per risolvere i warning di deprecazione);
   * Rimozione totale del download remoto dello Shared SDK 0.3.0 da GitHub Release;
   * Verifica crittografica deterministica del TGZ locale `gestione-casa-shared-sdk-0.5.1.tgz` con SHA-256 (`9e4fee87e6309ee1753aed31b7524dfb573b4786c55c75b5fd76c6423d2d0529`);
   * Sequenza operativa garantita: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
2. `docs/checkpoints/CURRENT.md` — Stato progressivo di audit e avanzamento.

---

## 2. Verifica Deterministica SDK e Dipendenze
* **File TGZ:** `gestione-casa-shared-sdk-0.5.1.tgz` presente nella root di progetto.
* **SHA-256 Verificato:** `9e4fee87e6309ee1753aed31b7524dfb573b4786c55c75b5fd76c6423d2d0529` (OK).
* **Package Manifest:** `package.json` e `package-lock.json` puntano in modo coerente a `file:gestione-casa-shared-sdk-0.5.1.tgz`.
* **Nessun download remoto:** La CI è resa autonoma e non dipendente da release esterne o asset remoti non tracciati.

---

## 3. Risultati del Quality Gate Locale
* **TypeScript Typecheck (`npm run typecheck`):** **PASS** (0 errori)
* **ESLint (`npm run lint`):** **PASS** (0 errori, 0 warning)
* **Vitest Suite (`npm test`):**
  * File di test: **44 passed (44)**
  * Test totali: **358 passed (358)**
  * Test falliti: **0**
  * Test saltati: **0**
* **Production Build (`npm run build`):** **PASS**

---

## 4. Prossimo Passo
* Verifica esecuzione workflow CI GitHub Actions prima di procedere con la fase `2.6.C2-E2`.
