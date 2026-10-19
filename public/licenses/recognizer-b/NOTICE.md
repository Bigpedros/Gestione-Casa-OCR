# OCRS / RTen — secondo lettore

OCRS e RTen sono progetti di Robert Knight.

- https://github.com/robertknight/ocrs
- https://github.com/robertknight/rten
- Licenze del codice: MIT oppure Apache License 2.0.

Modelli `text-detection.rten` e `text-recognition.rten`:

- Autore: Robert Knight / ocrs.
- https://huggingface.co/robertknight/ocrs
- https://github.com/robertknight/ocrs-models
- Licenza: Creative Commons Attribution-ShareAlike 4.0 International.
- https://creativecommons.org/licenses/by-sa/4.0/
- Modelli distribuiti senza modifiche, come nel banco MOTORE-OCR-AI.
- Dataset di addestramento documentato: HierText (Google Research), CC-BY-SA 4.0.

Il bridge Rust/WASM è ripreso da Bigpedros/MOTORE-OCR-AI.
Provenienza e adattamenti: docs/PEI_PHASE2_DUAL_READER.md.

La variante SIMD e il metodo di rilettura di righe localizzate usano gli stessi
modelli non modificati e le medesime licenze. Build riproducibile e modifiche:
docs/PEI_PERFORMANCE_PHASE2.md e public/recognizer-b/simd/build.json.
