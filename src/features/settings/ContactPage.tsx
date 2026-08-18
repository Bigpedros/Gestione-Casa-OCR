import React, { useState, useRef } from 'react';
import {
  ContactRequestValidator,
  createContactRequestExchangeEnvelope,
  serializeContactRequestExchangeEnvelope,
  buildContactRequestExchangeFileName,
} from '@gestione-casa/shared-sdk';
import type {
  ContactRequestDocument,
  ContactRequestType,
  PreferredContactChannel,
} from '@gestione-casa/shared-sdk/contact-requests';
import { contactRequestRepository } from '../../repositories';
import { getOrCreateDeviceId } from '../../services/deviceService';
import {
  importContactRequestSyncResponse,
  type ImportSyncResponseResult,
} from '../../services/contactRequestSyncService';
import { APP_CONFIG } from '../../config/app.config';
import { PageHeader, DashboardCard, Button } from '../../components/common';
import { Mail, CheckCircle2, AlertCircle, Download, ExternalLink, Upload } from 'lucide-react';

export const REQUEST_TYPE_OPTIONS: { value: ContactRequestType; label: string }[] = [
  { value: 'information', label: 'Informazioni' },
  { value: 'support', label: 'Supporto' },
  { value: 'license_request', label: 'Richiesta licenza' },
  { value: 'activation_request', label: 'Richiesta attivazione' },
  { value: 'renewal_request', label: 'Richiesta rinnovo' },
  { value: 'other', label: 'Altro' },
];

export interface RequestSubtypeOption {
  value: string;
  label: string;
}

export const REQUEST_SUBTYPE_OPTIONS_MAP: Record<ContactRequestType, RequestSubtypeOption[]> = {
  support: [
    { value: 'ocr_receipt_issue', label: 'Problema OCR / lettura scontrino' },
    { value: 'product_recognition_issue', label: 'Problema prodotti o riconoscimento prodotto' },
    { value: 'supplier_issue', label: 'Problema fornitori' },
    { value: 'income_expense_issue', label: 'Problema entrate / uscite' },
    { value: 'report_issue', label: 'Problema report' },
    { value: 'backup_restore_issue', label: 'Backup / ripristino' },
    { value: 'app_ui_issue', label: 'Problema applicazione / interfaccia' },
    { value: 'license_issue', label: 'Problema licenza' },
    { value: 'other_technical_issue', label: 'Altro problema tecnico' },
  ],
  information: [
    { value: 'how_it_works_info', label: 'Informazioni sul funzionamento' },
    { value: 'commercial_info', label: 'Informazioni commerciali' },
    { value: 'compatibility_requirements_info', label: 'Compatibilità / requisiti' },
    { value: 'app_features_info', label: "Funzioni dell'applicazione" },
    { value: 'other_info', label: 'Altro' },
  ],
  license_request: [
    { value: 'new_license', label: 'Nuova licenza' },
    { value: 'license_info', label: 'Informazioni sulla licenza' },
    { value: 'license_delivery_issue', label: 'Problema ricezione licenza' },
    { value: 'other_license_request', label: 'Altro' },
  ],
  activation_request: [
    { value: 'activation_failed', label: 'Attivazione non riuscita' },
    { value: 'unrecognized_code', label: 'Codice non riconosciuto' },
    { value: 'device_limit_reached', label: 'Limite dispositivi' },
    { value: 'reactivation_new_device', label: 'Riattivazione dopo cambio dispositivo' },
    { value: 'other_activation_request', label: 'Altro' },
  ],
  renewal_request: [
    { value: 'renewal_info', label: 'Informazioni sul rinnovo' },
    { value: 'renewal_issue', label: 'Problema rinnovo' },
    { value: 'license_data_update', label: 'Aggiornamento dati licenza' },
    { value: 'other_renewal_request', label: 'Altro' },
  ],
  other: [
    { value: 'suggestion_improvement', label: 'Suggerimento / miglioramento' },
    { value: 'generic_report', label: 'Segnalazione generica' },
    { value: 'payment_admin', label: 'Pagamento / amministrazione' },
    { value: 'privacy_inquiry', label: 'Privacy' },
    { value: 'other_general', label: 'Altro' },
  ],
};

export const getSubtypeLabel = (requestType: ContactRequestType, subtypeValue: string): string => {
  const options = REQUEST_SUBTYPE_OPTIONS_MAP[requestType] || [];
  const found = options.find((opt) => opt.value === subtypeValue);
  return found ? found.label : subtypeValue;
};

export const CONTACT_CHANNEL_OPTIONS: { value: PreferredContactChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefono' },
];

export const ContactPage: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [requestType, setRequestType] = useState<ContactRequestType>('support');
  const [requestSubtype, setRequestSubtype] = useState('');
  const [preferredContactChannel, setPreferredContactChannel] =
    useState<PreferredContactChannel>('email');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedRequest, setSavedRequest] = useState<ContactRequestDocument | null>(null);

  const [importResult, setImportResult] = useState<ImportSyncResponseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRequestTypeChange = (newType: ContactRequestType) => {
    setRequestType(newType);
    const validSubtypes = REQUEST_SUBTYPE_OPTIONS_MAP[newType] || [];
    if (!validSubtypes.some((opt) => opt.value === requestSubtype)) {
      setRequestSubtype('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!privacyAccepted) {
      setValidationError('È necessario prestare il consenso al trattamento dei dati per proseguire.');
      return;
    }

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedCompanyName = companyName.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    const trimmedSubtype = requestSubtype.trim();

    if (preferredContactChannel === 'phone' && !trimmedPhone) {
      setValidationError('Il numero di telefono è obbligatorio quando il canale di contatto preferito è Telefono.');
      return;
    }

    const fullName = [trimmedFirstName, trimmedLastName].filter(Boolean).join(' ');

    const nowIso = new Date().toISOString();
    const generatedId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const deviceId = await getOrCreateDeviceId();

    const metadata: Record<string, unknown> = trimmedSubtype
      ? { requestSubtype: trimmedSubtype }
      : {};

    const candidateDoc: ContactRequestDocument = {
      id: generatedId,
      requestType,
      status: 'new',
      source: 'gestione_casa_ocr',
      displayName: fullName || trimmedCompanyName || trimmedEmail,
      firstName: trimmedFirstName || 'Utente',
      lastName: trimmedLastName || null,
      companyName: trimmedCompanyName || null,
      email: trimmedEmail,
      phone: trimmedPhone || null,
      preferredContactChannel,
      subject: trimmedSubject || `Richiesta: ${requestType}`,
      message: trimmedMessage,
      privacyAcceptedAt: nowIso,
      linkedCustomerId: null,
      linkedLicenseId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      reviewedAt: null,
      closedAt: null,
      sourceDeviceId: deviceId,
      sourceAppVersion: APP_CONFIG.version,
      syncStatus: 'pending',
      schemaVersion: 1,
      metadata,
    };

    const validationRes = ContactRequestValidator.validate(candidateDoc);
    if (!validationRes.isValid) {
      const firstIssue = validationRes.issues[0]?.message || 'I dati inseriti non sono validi.';
      setValidationError(firstIssue);
      return;
    }

    try {
      setIsSubmitting(true);
      const created = await contactRequestRepository.create(candidateDoc);
      setSavedRequest(created);
    } catch (err: unknown) {
      setValidationError((err as Error).message || 'Si è verificato un errore durante il salvataggio.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportJson = () => {
    if (!savedRequest) return;

    const envelopeRes = createContactRequestExchangeEnvelope(savedRequest);
    if (!envelopeRes.isValid || !envelopeRes.value) {
      setValidationError('Impossibile generare l’inviluppo di esportazione.');
      return;
    }

    const serializeRes = serializeContactRequestExchangeEnvelope(envelopeRes.value);
    if (!serializeRes.isValid || !serializeRes.value) {
      setValidationError('Impossibile serializzare la richiesta.');
      return;
    }

    const fileNameRes = buildContactRequestExchangeFileName(envelopeRes.value);
    const fileName = fileNameRes.isValid && fileNameRes.value
      ? fileNameRes.value
      : `contact_request_${savedRequest.id}.json`;

    const blob = new Blob([serializeRes.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenMailto = () => {
    if (!savedRequest) return;

    const recipient = 'gestionecasaocr@gmail.com';
    const emailSubject = encodeURIComponent(`[Gestione Casa OCR] Richiesta Supporto ID: ${savedRequest.id}`);
    const subtypeStr =
      typeof savedRequest.metadata?.requestSubtype === 'string' && savedRequest.metadata.requestSubtype
        ? `\nDettaglio: ${getSubtypeLabel(savedRequest.requestType, savedRequest.metadata.requestSubtype)}`
        : '';
    const companyStr = savedRequest.companyName ? `\nRagione Sociale: ${savedRequest.companyName}` : '';
    const emailBody = encodeURIComponent(
      `ID Richiesta: ${savedRequest.id}\n` +
      `Tipo Richiesta: ${savedRequest.requestType}${subtypeStr}${companyStr}\n` +
      `Oggetto: ${savedRequest.subject}\n\n` +
      `Promemoria: Allega manualmente il file JSON esportato dalla richiesta se necessario.`
    );

    window.location.href = `mailto:${recipient}?subject=${emailSubject}&body=${emailBody}`;
  };

  const handleNewRequest = () => {
    setSavedRequest(null);
    setFirstName('');
    setLastName('');
    setCompanyName('');
    setEmail('');
    setPhone('');
    setRequestType('support');
    setRequestSubtype('');
    setPreferredContactChannel('email');
    setSubject('');
    setMessage('');
    setPrivacyAccepted(false);
    setValidationError(null);
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await importContactRequestSyncResponse(text);
      setImportResult(res);
      if (res.document) {
        const updated = await contactRequestRepository.getById(res.document.id);
        if (updated && savedRequest && savedRequest.id === updated.id) {
          setSavedRequest(updated);
        }
      }
    } catch (err: unknown) {
      setImportResult({
        success: false,
        status: 'invalid_format',
        message: (err as Error).message || 'Errore durante la lettura del file.',
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<Mail className="w-6 h-6 text-indigo-600" />}
        title="Supporto e Contatti"
        subtitle="Invia una richiesta di supporto o informazioni. I dati verranno memorizzati localmente."
      />

      {savedRequest ? (
        <DashboardCard
          title="Richiesta salvata correttamente"
          badge={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
        >
          <div className="space-y-6 pt-2">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-sm text-emerald-900 dark:text-emerald-200 space-y-2">
              <p className="font-semibold text-base">Richiesta salvata correttamente.</p>
              <p className="text-xs">
                La richiesta è stata memorizzata nel database locale. Lo stato di sincronizzazione è{' '}
                <span className="font-mono bg-emerald-100 dark:bg-emerald-900 px-1.5 py-0.5 rounded text-emerald-800 dark:text-emerald-300 font-bold">
                  {savedRequest.syncStatus}
                </span>. Nessun invio automatico è avvenuto.
              </p>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs space-y-1.5 font-medium text-slate-700 dark:text-slate-300">
              <p>ID Richiesta: <strong className="text-slate-900 dark:text-white font-mono">{savedRequest.id}</strong></p>
              <p>Tipo Richiesta: <strong className="text-slate-900 dark:text-white">{REQUEST_TYPE_OPTIONS.find(o => o.value === savedRequest.requestType)?.label || savedRequest.requestType}</strong></p>
              {typeof savedRequest.metadata?.requestSubtype === 'string' && savedRequest.metadata.requestSubtype && (
                <p>Dettaglio della richiesta: <strong className="text-slate-900 dark:text-white">{getSubtypeLabel(savedRequest.requestType, savedRequest.metadata.requestSubtype)}</strong></p>
              )}
              <p>Nome: <strong className="text-slate-900 dark:text-white">{savedRequest.displayName}</strong></p>
              {savedRequest.companyName && (
                <p>Ragione sociale: <strong className="text-slate-900 dark:text-white">{savedRequest.companyName}</strong></p>
              )}
              <p>Email: <strong className="text-slate-900 dark:text-white">{savedRequest.email}</strong></p>
              {savedRequest.phone && (
                <p>Telefono: <strong className="text-slate-900 dark:text-white">{savedRequest.phone}</strong></p>
              )}
              <p>Canale preferito: <strong className="text-slate-900 dark:text-white">{savedRequest.preferredContactChannel === 'phone' ? 'Telefono' : 'Email'}</strong></p>
              <p>Oggetto: <strong className="text-slate-900 dark:text-white">{savedRequest.subject}</strong></p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Button
                type="button"
                variant="primary"
                icon={<Download className="w-4 h-4" />}
                onClick={handleExportJson}
              >
                Esporta JSON richiesta
              </Button>

              <Button
                type="button"
                variant="secondary"
                icon={<ExternalLink className="w-4 h-4" />}
                onClick={handleOpenMailto}
              >
                Apri email
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={handleNewRequest}
              >
                Nuova richiesta
              </Button>
            </div>
          </div>
        </DashboardCard>
      ) : (
        <DashboardCard
          title="Compila il modulo di contatto"
          subtitle="Compila tutti i campi obbligatori per memorizzare la richiesta sul tuo dispositivo."
        >
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {validationError && (
              <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 rounded-2xl text-xs font-medium border border-rose-200 dark:border-rose-900">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-first-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome <span className="text-rose-500">*</span>
                </label>
                <input
                  id="contact-first-name"
                  type="text"
                  required
                  placeholder="Inserisci il nome"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>

              <div>
                <label htmlFor="contact-last-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Cognome
                </label>
                <input
                  id="contact-last-name"
                  type="text"
                  placeholder="Inserisci il cognome (opzionale)"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-company-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Ragione sociale (opzionale)
                </label>
                <input
                  id="contact-company-name"
                  type="text"
                  placeholder="Nome azienda o ente (opzionale)"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>

              <div>
                <label htmlFor="contact-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  placeholder="nome@esempio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-request-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tipo di richiesta <span className="text-rose-500">*</span>
                </label>
                <select
                  id="contact-request-type"
                  value={requestType}
                  onChange={(e) => handleRequestTypeChange(e.target.value as ContactRequestType)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm cursor-pointer"
                >
                  {REQUEST_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="contact-request-subtype" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Dettaglio della richiesta
                </label>
                <select
                  id="contact-request-subtype"
                  value={requestSubtype}
                  onChange={(e) => setRequestSubtype(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm cursor-pointer"
                >
                  <option value="">Seleziona dettaglio (opzionale)...</option>
                  {(REQUEST_SUBTYPE_OPTIONS_MAP[requestType] || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-preferred-channel" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Canale di contatto preferito <span className="text-rose-500">*</span>
                </label>
                <select
                  id="contact-preferred-channel"
                  value={preferredContactChannel}
                  onChange={(e) =>
                    setPreferredContactChannel(e.target.value as PreferredContactChannel)
                  }
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm cursor-pointer"
                >
                  {CONTACT_CHANNEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="contact-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Telefono {preferredContactChannel === 'phone' ? <span className="text-rose-500">*</span> : <span className="text-slate-400 font-normal">(opzionale)</span>}
                </label>
                <input
                  id="contact-phone"
                  type="tel"
                  required={preferredContactChannel === 'phone'}
                  placeholder="+39 333 1234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="contact-subject" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Oggetto / Titolo <span className="text-rose-500">*</span>
              </label>
              <input
                id="contact-subject"
                type="text"
                required
                placeholder="Breve titolo della richiesta"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="contact-message" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Messaggio <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="contact-message"
                required
                rows={4}
                placeholder="Descrivi dettagliatamente la tua richiesta"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                <input
                  id="contact-privacy-consent"
                  type="checkbox"
                  required
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 rounded-xs text-indigo-600 focus:ring-indigo-500"
                />
                <span>
                  Acconsento al trattamento dei dati personali per la gestione della richiesta di contatto.{' '}
                  <span className="text-slate-500 dark:text-slate-400">
                    La richiesta viene salvata localmente nell’applicazione e può essere esportata manualmente.
                  </span>
                </span>
              </label>
            </div>

            <div className="pt-4 flex justify-end">
              <Button
                type="submit"
                variant="primary"
                disabled={isSubmitting}
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                {isSubmitting ? 'Salvataggio in corso...' : 'Salva richiesta in locale'}
              </Button>
            </div>
          </form>
        </DashboardCard>
      )}

      <DashboardCard
        title="Importazione Risposta License Manager"
        subtitle="Importa il file JSON di risposta generato dal License Manager per riconciliare lo stato della richiesta."
      >
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Seleziona il file JSON di risposta (.json)
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lo SDK verificherà la validità dell'inviluppo e aggiornerà lo stato di sincronizzazione locale.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFileChange}
            />

            <Button
              type="button"
              variant="secondary"
              icon={<Upload className="w-4 h-4" />}
              onClick={() => fileInputRef.current?.click()}
            >
              Importa risposta License Manager
            </Button>
          </div>

          {importResult && (
            <div
              className={`p-4 rounded-2xl border text-sm space-y-2 ${
                importResult.status === 'applied'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                  : importResult.status === 'equivalent'
                  ? 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200'
                  : importResult.status === 'conflict'
                  ? 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                  : importResult.status === 'missing_local_record'
                  ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
                  : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {importResult.status === 'applied' && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {importResult.status === 'equivalent' && <CheckCircle2 className="w-5 h-5 text-blue-600" />}
                {importResult.status === 'conflict' && <AlertCircle className="w-5 h-5 text-rose-600" />}
                {importResult.status === 'missing_local_record' && <AlertCircle className="w-5 h-5 text-amber-600" />}
                {importResult.status === 'invalid_format' && <AlertCircle className="w-5 h-5 text-rose-600" />}
                <span>
                  {importResult.status === 'applied' && 'Risposta applicata con successo'}
                  {importResult.status === 'equivalent' && 'Già sincronizzata'}
                  {importResult.status === 'conflict' && 'Conflitto di sincronizzazione'}
                  {importResult.status === 'missing_local_record' && 'Richiesta locale non trovata'}
                  {importResult.status === 'invalid_format' && 'File non valido o formato non supportato'}
                </span>
              </div>

              <p className="text-xs">{importResult.message}</p>

              {importResult.document && (
                <div className="pt-2 border-t border-current/10 text-xs space-y-1 font-mono">
                  <p>ID: <strong>{importResult.document.id}</strong></p>
                  <p>Stato Business: <strong>{importResult.document.status}</strong></p>
                  <p>Stato Sincronizzazione: <strong className="uppercase">{importResult.document.syncStatus}</strong></p>
                  {importResult.document.linkedCustomerId && (
                    <p>Linked Customer ID: <strong>{importResult.document.linkedCustomerId}</strong></p>
                  )}
                  {importResult.document.linkedLicenseId && (
                    <p>Linked License ID: <strong>{importResult.document.linkedLicenseId}</strong></p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DashboardCard>
    </div>
  );
};
