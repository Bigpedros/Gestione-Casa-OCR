# Stato Operativo Corrente — Gestione-Casa-OCR

* **Data Checkpoint:** 29 Agosto 2026
* **Istanza AI Studio:** `Gestione-Casa-OCR`
* **Repository Canonico:** `Bigpedros/Gestione-Casa-OCR`
* **Branch:** `main`
* **Runtime Node.js:** `22`
* **Shared SDK:** `@gestione-casa/shared-sdk@0.5.1`
* **Tarball Locale SDK:** `gestione-casa-shared-sdk-0.5.1.tgz`
* **SHA-256 TGZ:** `9e4fee87e6309ee1753aed31b7524dfb573b4786c55c75b5fd76c6423d2d0529`

---

## Stato Avanzamento Moduli & Fasi

* **Fase P3 (OCR Pipeline Foundations):** `CHIUSO / VALIDATO`
* **Fase P4-A (DocumentTypeClassifier Integration):** `CHIUSO / VALIDATO`
* **Fase P4-B1 (ReceiptZoneSegmenter & Shadow Mode):** `CHIUSO / VALIDATO`
* **Fase P4-B2 (LineItemParserV2 Switch Ufficiale per COMMERCIAL_RECEIPT):** `CHIUSO / VALIDATO`
* **Fase P4-B2-R (Regola Ceccotti — Prezzo Non Rilevato ≠ Prezzo Zero):** `CHIUSO / VALIDATO` (7/7 test PASS dedicati)
* **PaymentEvidenceParser:** Validato e testato, NON ancora integrato nella pipeline runtime (programmato in P4-C)
* **Stato Fallback:** `LineItemParser` V1 mantenuto attivo come fallback tecnico di sicurezza

---

## Quality Gate Certificato (Baseline Congelata)

* **TypeScript Typecheck (`npm run typecheck`):** `PASS` (0 errori)
* **ESLint (`npm run lint`):** `PASS` (0 errori, 0 warning)
* **Vitest Suite (`npm test`):**
  * **File di test:** 65 / 65 `PASS`
  * **Test totali:** 589 / 589 `PASS` (0 FAIL, 0 SKIP)
* **Production Build (`npm run build`):** `PASS` (dist e PWA generate con successo)

---

## Prossimi Passi

1. **Sincronizzazione GitHub:** Push della baseline consolidata al repository canonico `Bigpedros/Gestione-Casa-OCR`.
2. **GitHub Actions CI:** Attesa esito verde della pipeline remota.
3. **Fase P4-C:** Integrazione e attivazione runtime di `PaymentEvidenceParser` (solo dopo CI verde confermata).

