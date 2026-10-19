# MOTORE-OCR-AI — integrazione Gestione Casa

Baseline OCR importata da `Bigpedros/MOTORE-OCR-AI` al commit
`be0005803ed60eadd4eb4030b7d2a2bad79a5c29` (package `0.4.1-alpha.4`).

## Perimetro

Gestione Casa usa il core ottico generalista per acquisizione fotografica,
quality gate, orientamento, deskew/dewarp, varianti Tesseract, seconda lettura
indipendente OCRS/RTen e stabilizzazione tramite Decision Engine.

La semantica scontrino, la revisione utente e la registrazione contabile restano
nei moduli Gestione Casa: il motore OCR non crea spese.

## Runtime Recognizer B

Il repository MOTORE-OCR-AI contiene il sorgente Rust del Recognizer B ma non
versiona i grandi artefatti generati. La build di Gestione Casa installa gli
artefatti OCRS/RTen già compilati e collaudati da PEI-Facile-2, fissati al commit
`8816d199be299544b0f2ceb8cca667c04382ba7c`. Non viene importata logica applicativa PEI.

Percorsi runtime:
- `/recognizer-b/ocrs_wasm.js`
- `/recognizer-b/ocrs_wasm_bg.wasm`
- `/models/text-detection.rten`
- `/models/text-recognition.rten`

L'avviso di licenza è in `public/licenses/recognizer-b/NOTICE.md`.
