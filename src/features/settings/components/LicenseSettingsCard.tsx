import React, { useState } from 'react';
import {
  Key,
  ShieldCheck,
  ShieldX,
  RefreshCw,
  PowerOff,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Laptop,
  AlertCircle,
  X,
} from 'lucide-react';
import { DashboardCard, Badge, Button, Modal } from '../../../components/common';
import { useLicense } from '../../../hooks/useLicense';

function formatDate(isoString?: string | null): string {
  if (!isoString) return 'Nessuna scadenza (Perpetua)';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function formatDateTime(isoString?: string | null): string {
  if (!isoString) return 'Non disponibile';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export const LicenseSettingsCard: React.FC = () => {
  const {
    localState,
    maskedLicenseCode,
    maskedDeviceId,
    status,
    validationStatus,
    isValid,
    lastSuccessfulOnlineValidation,
    offlineValidUntil,
    licenseExpiresAt,
    deactivationStatus,
    schemaVersion,
    edition,
    owner,
    isLoading,
    isOperating,
    activateLicense,
    validateLicense,
    deactivateLicense,
  } = useLicense();

  const [inputCode, setInputCode] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{
    type: 'success' | 'error' | 'warning' | 'info';
    text: string;
  } | null>(null);
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);

  // Calcolo finestra offline in scadenza (entro 5 giorni)
  const isExpiringSoon = (() => {
    if (!isValid || !offlineValidUntil) return false;
    const untilMs = new Date(offlineValidUntil).getTime();
    if (isNaN(untilMs)) return false;
    const nowMs = Date.now();
    const diffDays = (untilMs - nowMs) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 5;
  })();

  const isOfflineExpired = (() => {
    if (!offlineValidUntil) return false;
    const untilMs = new Date(offlineValidUntil).getTime();
    if (isNaN(untilMs)) return false;
    return Date.now() > untilMs;
  })();

  // Gestione attivazione
  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackMsg(null);

    const codeToActivate = inputCode.trim().toUpperCase();
    if (!codeToActivate) {
      setFeedbackMsg({
        type: 'error',
        text: 'Inserisci un codice licenza valido prima di procedere.',
      });
      return;
    }

    const result = await activateLicense(codeToActivate);
    if (result.success) {
      setInputCode('');
      setFeedbackMsg({
        type: 'success',
        text: result.message || 'Licenza attivata e verificata con successo!',
      });
    } else {
      setFeedbackMsg({
        type: 'error',
        text: result.message || "Errore durante l'attivazione della licenza.",
      });
    }
  };

  // Gestione validazione online manuale
  const handleValidateNow = async () => {
    setFeedbackMsg(null);
    const result = await validateLicense();

    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: result.message || 'Validazione licenza online completata con successo.',
      });
    } else if (result.isNetworkError) {
      setFeedbackMsg({
        type: 'info',
        text:
          result.message ||
          'Server non raggiungibile. L’applicazione continua a funzionare regolarmente in modalità offline.',
      });
    } else {
      setFeedbackMsg({
        type: 'error',
        text: result.message || 'Validazione licenza non riuscita dal server.',
      });
    }
  };

  // Gestione disattivazione
  const handleDeactivate = async () => {
    setIsDeactivateModalOpen(false);
    setFeedbackMsg(null);

    const result = await deactivateLicense();
    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: result.message || 'Licenza disattivata con successo dal dispositivo.',
      });
    } else if (result.confirmedOnServer === false) {
      setFeedbackMsg({
        type: 'warning',
        text:
          result.message ||
          'Disattivazione locale completata. In attesa di connessione per la conferma sul server.',
      });
    } else {
      setFeedbackMsg({
        type: 'error',
        text: result.message || 'Errore durante la disattivazione della licenza.',
      });
    }
  };

  // Badge di stato calcolato
  const renderStatusBadge = () => {
    if (isLoading) {
      return <Badge variant="neutral">Caricamento...</Badge>;
    }
    if (deactivationStatus === 'DEACTIVATION_PENDING_CONFIRMATION') {
      return <Badge variant="warning">Disattivazione in sospeso</Badge>;
    }
    if (status === 'deactivated' || deactivationStatus === 'DEACTIVATED') {
      return <Badge variant="neutral">Disattivata</Badge>;
    }
    if (status === 'LICENSE_REVOKED' || validationStatus === 'LICENSE_REVOKED') {
      return <Badge variant="danger">Revocata</Badge>;
    }
    if (status === 'LICENSE_SUSPENDED' || validationStatus === 'LICENSE_SUSPENDED') {
      return <Badge variant="danger">Sospesa</Badge>;
    }
    if (status === 'LICENSE_EXPIRED' || validationStatus === 'LICENSE_EXPIRED') {
      return <Badge variant="danger">Scaduta</Badge>;
    }
    if (status === 'DEVICE_MISMATCH' || validationStatus === 'DEVICE_MISMATCH') {
      return <Badge variant="danger">Dispositivo non corrispondente</Badge>;
    }
    if (
      status === 'OFFLINE_WINDOW_EXPIRED' ||
      validationStatus === 'OFFLINE_WINDOW_EXPIRED' ||
      isOfflineExpired
    ) {
      return <Badge variant="danger">Finestra offline scaduta</Badge>;
    }
    if (isValid) {
      if (isExpiringSoon) {
        return <Badge variant="warning">Valida Offline (In scadenza)</Badge>;
      }
      return <Badge variant="success">Attiva e Valida</Badge>;
    }
    return <Badge variant="neutral">Non attivata</Badge>;
  };

  const hasPendingDeactivation = deactivationStatus === 'DEACTIVATION_PENDING_CONFIRMATION';
  const isRevokedOrSuspended =
    status === 'LICENSE_REVOKED' ||
    validationStatus === 'LICENSE_REVOKED' ||
    status === 'LICENSE_SUSPENDED' ||
    validationStatus === 'LICENSE_SUSPENDED';

  return (
    <DashboardCard
      title="Licenza Software"
      badge={
        <div className="flex items-center gap-2">
          {renderStatusBadge()}
        </div>
      }
      subtitle="Gestione stato licenza, validazione certificata e associazione dispositivo per Gestione Casa OCR."
    >
      <div className="space-y-4 pt-2">
        {/* Banner notifiche e feedback */}
        {feedbackMsg && (
          <div
            className={`p-3.5 rounded-2xl border text-xs flex items-start justify-between gap-3 ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : feedbackMsg.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                : feedbackMsg.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                : 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800'
            }`}
          >
            <div className="flex items-center gap-2 flex-1">
              {feedbackMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              {feedbackMsg.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
              {feedbackMsg.type === 'warning' && <AlertTriangle className="w-4 h-4 shrink-0" />}
              {feedbackMsg.type === 'info' && <ShieldCheck className="w-4 h-4 shrink-0" />}
              <span className="font-medium">{feedbackMsg.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMsg(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md"
              aria-label="Chiudi notifica"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Warning banner per finestra offline in scadenza */}
        {isExpiringSoon && (
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2.5">
            <Clock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span className="font-semibold">Finestra offline in scadenza: </span>
              <span>
                La validità offline scadrà il <strong>{formatDateTime(offlineValidUntil)}</strong>. Esegui
                una verifica online per rinnovarla.
              </span>
            </div>
          </div>
        )}

        {/* Warning banner per disattivazione in sospeso */}
        {hasPendingDeactivation && (
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <span className="font-semibold">Disattivazione in attesa di conferma: </span>
                <span>
                  La licenza è stata disattivata localmente. Connettiti a Internet per completare la
                  disattivazione sul server.
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isOperating}
              onClick={handleDeactivate}
            >
              Riprova disattivazione
            </Button>
          </div>
        )}

        {/* Alert per revoca o sospensione */}
        {isRevokedOrSuspended && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2.5">
            <ShieldX className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <div>
              <span className="font-semibold">Licenza non autorizzata: </span>
              <span>
                Questa licenza risulta {status === 'LICENSE_REVOKED' ? 'revocata' : 'sospesa'} dal
                server centrale. L’accesso alle funzionalità complete è inibito.
              </span>
            </div>
          </div>
        )}

        {/* Stato licenza ATTIVA o presente */}
        {localState && localState.licenseCode ? (
          <div className="space-y-4">
            {/* Griglia dettagli licenza */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium block">Codice Licenza</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-sm tracking-wider">
                  {maskedLicenseCode}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium block">Intestatario</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                  {owner || 'Privato / Gestione Casa'}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium block">Edizione & Schema</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm capitalize">
                  {edition || 'Standard'} {schemaVersion ? `(Schema V${schemaVersion})` : ''}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium block">Scadenza Licenza</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                  {formatDate(licenseExpiresAt)}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium block">Ultima Verifica Online</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                  {formatDateTime(lastSuccessfulOnlineValidation)}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1">
                <span className="text-slate-500 dark:text-slate-400 font-medium block">Valida Offline Fino a</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                  {formatDateTime(offlineValidUntil)}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 space-y-1 md:col-span-2 lg:col-span-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-medium">Dispositivo Associato</span>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <Laptop className="w-3.5 h-3.5" /> Binding Certificato
                  </span>
                </div>
                <span className="font-mono text-slate-700 dark:text-slate-300 font-medium">
                  {maskedDeviceId}
                </span>
              </div>
            </div>

            {/* Pulsanti di azione per licenza presente */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={<RefreshCw className={`w-3.5 h-3.5 ${isOperating ? 'animate-spin' : ''}`} />}
                  disabled={isOperating}
                  onClick={handleValidateNow}
                >
                  Verifica ora
                </Button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-rose-600 border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-900/50 dark:hover:bg-rose-950/30"
                icon={<PowerOff className="w-3.5 h-3.5 text-rose-500" />}
                disabled={isOperating}
                onClick={() => setIsDeactivateModalOpen(true)}
              >
                Disattiva Licenza
              </Button>
            </div>
          </div>
        ) : (
          /* Form di attivazione quando non c'è licenza */
          <form onSubmit={handleActivate} className="space-y-3.5">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Codice di Attivazione Licenza
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={inputCode}
                    onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                    placeholder="Es. ABCD-EFGH-JKMN-PQRQ"
                    className="flex-1 font-mono uppercase bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    disabled={isOperating}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    icon={<Key className="w-4 h-4" />}
                    disabled={isOperating || !inputCode.trim()}
                  >
                    Attiva Licenza
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Inserisci il codice licenza a 16 caratteri alfanumerici fornito al momento della registrazione. Il codice verrà verificato crittograficamente e associato in modo sicuro a questa postazione.
              </p>
            </div>
          </form>
        )}
      </div>

      {/* Modal di conferma disattivazione */}
      <Modal
        isOpen={isDeactivateModalOpen}
        onClose={() => setIsDeactivateModalOpen(false)}
        title="Disattiva Licenza Software"
        subtitle="Conferma la disattivazione della licenza su questo dispositivo"
      >
        <div className="space-y-4 pt-1 text-sm text-slate-600 dark:text-slate-300">
          <p>
            Sei sicuro di voler disattivare la licenza <strong>{maskedLicenseCode}</strong> su questo
            dispositivo?
          </p>
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <span className="font-bold block">Attenzione:</span>
            <span>
              La disattivazione libererà la postazione sul server centrale per consentirti di installare o
              trasferire la licenza su un altro dispositivo.
            </span>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsDeactivateModalOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="bg-rose-600 hover:bg-rose-700 text-white border-transparent"
              icon={<PowerOff className="w-3.5 h-3.5" />}
              disabled={isOperating}
              onClick={handleDeactivate}
            >
              Conferma Disattivazione
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardCard>
  );
};
