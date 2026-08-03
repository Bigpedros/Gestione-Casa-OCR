import type { AppNotification } from '../types';

export interface EmailDeliveryResult {
  success: boolean;
  status: 'provider_not_configured' | 'sent' | 'failed';
  message: string;
}

export const emailNotificationService = {
  sendDeadlineReminder: async (
    _notification: Partial<AppNotification>,
    recipientEmails: string[]
  ): Promise<EmailDeliveryResult> => {
    if (!recipientEmails || recipientEmails.length === 0) {
      return {
        success: false,
        status: 'provider_not_configured',
        message: 'Nessun indirizzo e-mail destinatario specificato.',
      };
    }

    // Since no backend SMTP/Email service is configured in the sandbox environment,
    // we clearly report provider_not_configured without fake "Sent" messages or exposing credentials.
    return {
      success: false,
      status: 'provider_not_configured',
      message: 'Servizio e-mail non configurato (in attesa di provider backend).',
    };
  },
};
