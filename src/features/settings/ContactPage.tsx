import React, { useState } from 'react';
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
import { APP_CONFIG } from '../../config/app.config';
import { PageHeader, DashboardCard, Button } from '../../components/common';
import { Mail, CheckCircle2, AlertCircle, Download, ExternalLink } from 'lucide-react';

export const REQUEST_TYPE_OPTIONS: { value: ContactRequestType; label: string }[] = [
  { value: 'information', label: 'Informazioni' },
  { value: 'support', label: 'Supporto' },
  { value: 'license_request', label: 'Richiesta licenza' },
  { value: 'activation_request', label: 'Richiesta attivazione' },
  { value: 'renewal_request', label: 'Richiesta rinnovo' },
  { value: 'other', label: 'Altro' },
];

export const CONTACT_CHANNEL_OPTIONS: { value: PreferredContactChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefono' },
];

export const ContactPage: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [requestType, setRequestType] = useState<ContactRequestType>('support');
  const [preferredContactChannel, setPreferredContactChannel] =
    useState<PreferredContactChannel>('email');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedRequest, setSavedRequest] = useState<ContactRequestDocument | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!privacyAccepted) {
      setValidationError('È necessario prestare il consenso al trattamento dei dati per proseguire.');
      return;
    }

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    const fullName = [trimmedFirstName, trimmedLastName].filter(Boolean).join(' ');

    const nowIso = new Date().toISOString();
    const generatedId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const deviceId = await getOrCreateDeviceId();

    const candidateDoc: ContactRequestDocument = {
      id: generatedId,
      requestType,
      status: 'new',
      source: 'gestione_casa_ocr',
      displayName: fullName || trimmedEmail,
      firstName: trimmedFirstName || 'Utente',
      lastName: trimmedLastName || null,
      companyName: null,
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
      metadata: {},
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
    const emailBody = encodeURIComponent(
      `ID Richiesta: ${savedRequest.id}\n` +
      `Tipo Richiesta: ${savedRequest.requestType}\n` +
      `Oggetto: ${savedRequest.subject}\n\n` +
      `Promemoria: Allega manualmente il file JSON esportato dalla richiesta se necessario.`
    );

    window.location.href = `mailto:${recipient}?subject=${emailSubject}&body=${emailBody}`;
  };

  const handleNewRequest = () => {
    setSavedRequest(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setRequestType('support');
    setPreferredContactChannel('email');
    setSubject('');
    setMessage('');
    setPrivacyAccepted(false);
    setValidationError(null);
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
              <p>Tipo Richiesta: <strong className="text-slate-900 dark:text-white">{savedRequest.requestType}</strong></p>
              <p>Nome: <strong className="text-slate-900 dark:text-white">{savedRequest.displayName}</strong></p>
              <p>Email: <strong className="text-slate-900 dark:text-white">{savedRequest.email}</strong></p>
              <p>Canale preferito: <strong className="text-slate-900 dark:text-white">{savedRequest.preferredContactChannel}</strong></p>
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

              <div>
                <label htmlFor="contact-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Telefono {preferredContactChannel === 'phone' && <span className="text-rose-500">*</span>}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contact-request-type" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tipo di richiesta <span className="text-rose-500">*</span>
                </label>
                <select
                  id="contact-request-type"
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value as ContactRequestType)}
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
    </div>
  );
};
