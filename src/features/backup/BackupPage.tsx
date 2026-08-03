import React, { useState } from 'react';
import { backupService } from '../../services/backupService';
import {
  PageHeader,
  DashboardCard,
  Button,
} from '../../components/common';
import { HardDrive, Download, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { BackupData } from '../../types';

export const BackupPage: React.FC = () => {
  const [importedData, setImportedData] = useState<BackupData | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExport = async () => {
    try {
      const jsonStr = await backupService.exportBackup();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GestioneCasa_Backup_${new Date().toISOString().substring(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ type: 'success', text: 'Backup esportato con successo!' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Errore durante l'esportazione: ${(err as Error).message}` });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      const res = backupService.validateBackup(content);
      if (res.isValid && res.data) {
        setImportedData(res.data);
        setStatusMsg({ type: 'success', text: 'File di backup valido. Verifica l\'anteprima prima di ripristinare.' });
      } else {
        setImportedData(null);
        setStatusMsg({ type: 'error', text: res.error || 'File di backup non valido.' });
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!importedData) return;
    try {
      await backupService.importBackup(importedData);
      setImportedData(null);
      setStatusMsg({ type: 'success', text: 'Database ripristinato con successo! Ricarica la pagina se necessario.' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Errore durante il ripristino: ${(err as Error).message}` });
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <PageHeader
        icon={<HardDrive className="w-6 h-6 text-indigo-600" />}
        title="Backup e Ripristino Dati Locale"
        subtitle="Tutti i dati risiedono esclusivamente nel tuo dispositivo. Esegui periodicamente un backup per sicurezza."
      />

      {statusMsg && (
        <div
          className={`p-4 rounded-2xl border flex items-center gap-3 text-sm font-semibold ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export Box */}
        <DashboardCard>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 shrink-0">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">Esporta Backup JSON</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Scarica una copia completa del database locale in formato JSON.</p>
              </div>
            </div>

            <Button
              variant="primary"
              fullWidth
              onClick={handleExport}
            >
              Scarica File Backup
            </Button>
          </div>
        </DashboardCard>

        {/* Import Box */}
        <DashboardCard>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 shrink-0">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">Ripristina da Backup</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Seleziona un file JSON di Gestione Casa per ripristinare i dati.</p>
              </div>
            </div>

            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-200 cursor-pointer"
            />
          </div>
        </DashboardCard>
      </div>

      {/* Preview and Confirmation Box */}
      {importedData && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-6 rounded-3xl space-y-4 shadow-xs">
          <div className="flex items-start gap-3 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-base">Conferma Ripristino Dati</h4>
              <p className="text-xs mt-1 leading-relaxed">
                Attenzione: il ripristino sostituirà tutti i dati attualmente presenti nel database <strong>gestioneCasa</strong>.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-200/60 dark:border-amber-800/60 text-xs space-y-1.5 font-medium">
            <p>Nome App: <strong className="text-slate-900 dark:text-white">{importedData.appName}</strong></p>
            <p>Database Target: <strong className="text-slate-900 dark:text-white">{importedData.databaseName}</strong></p>
            <p>Data Esportazione: <strong className="text-slate-900 dark:text-white">{importedData.exportedAt}</strong></p>
            <p className="text-indigo-600 dark:text-indigo-400 font-bold">Entrate: {importedData.tables.incomeEntries?.length || 0} | Uscite: {importedData.tables.expenses?.length || 0} | Progetti: {importedData.tables.projects?.length || 0}</p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setImportedData(null)}
            >
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmImport}
            >
              Conferma e Sovrascrivi Dati
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
