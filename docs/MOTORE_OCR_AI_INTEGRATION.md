# MOTORE-OCR-AI — integrazione Gestione Casa

Baseline OCR importata da `Bigpedros/MOTORE-OCR-AI` al commit
`7e6738262d326099b7c73955207a371c09ee042f` (MOTORE `0.5.0-rc.1`, CI/certification green).

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


## Allineamento MOTORE 0.5

Il vendor OCR è stato riallineato alla baseline certificata MOTORE 0.5 mantenendo separata la semantica applicativa di Gestione Casa.

Capacità donate:
- detector fotografico ibrido luminanza + bordi/Hough;
- deskew residuo, curvature metrics e dewarp custodito;
- camera cleanup conservativo;
- varianti OCR lazy con fast path;
- orchestratore per pagina;
- telemetria per stadio;
- provider/Recognizer B aggiornati.

La logica di parsing scontrino, knowledge base, contabilità e revisione utente resta nel livello applicativo Gestione Casa.


## Receipt Line Fusion
La baseline `7e6738262d326099b7c73955207a371c09ee042f` aggiunge fusione receipt a livello di riga tra Tesseract e OCRS/RTen. La fusione usa ancore geometriche/semantiche di riga (IVA/prezzo) e produce evidenze senza mutare il raw OCR.


## Receipt Item Block Reconstruction v1
La baseline `7e6738262d326099b7c73955207a371c09ee042f` ricostruisce voci commerciali indipendentemente dai lineId OCR e dal layout grafico, usando coordinate fisiche, campi Articolo/IVA/Prezzo e relazioni quantità × prezzo unitario = totale. Supporta SINGLE_LINE, DESCRIPTION_CONTINUATION e QTY_UNIT_PREFIX.
