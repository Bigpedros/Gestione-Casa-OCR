# Architettura Local-First

**Gestione Casa** è concepita fin dal principio come un'applicazione **local-first**:

- **Privacy Totale**: Nessun dato personale o finanziario viene inviato a server cloud o tracciatori terzi.
- **IndexedDB via Dexie**: I dati risiedono localmente nel browser del dispositivo utente nel database `gestioneCasa`.
- **Funzionamento Offline Completo**: Service Worker e Application Shell garantiscono il corretto avvio e funzionamento in assenza di rete internet.
- **Portabilità via Backup**: Funzionalità di esportazione/importazione JSON completa con checksum e validazione Dexie transaction.
