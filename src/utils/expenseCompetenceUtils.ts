import { getAutomaticClosingDate } from '../services/monthClosingService';
import { reportRepository } from '../repositories';

export interface CompetencePeriod {
  competenceYear: number;
  competenceMonth: number;
}

/**
 * Deriva automaticamente mese (1-12) e anno di competenza contabile a partire da una data in formato ISO (YYYY-MM-DD).
 */
export const deriveCompetenceFromDate = (dateStr: string): CompetencePeriod => {
  if (!dateStr) {
    const now = new Date();
    return {
      competenceYear: now.getFullYear(),
      competenceMonth: now.getMonth() + 1,
    };
  }

  // Supporta sia "YYYY-MM-DD" che stringhe ISO con orario "YYYY-MM-DDTHH:mm:ss"
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length >= 2) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);

    if (!isNaN(year) && !isNaN(month) && month >= 1 && month <= 12) {
      return {
        competenceYear: year,
        competenceMonth: month,
      };
    }
  }

  const dateObj = new Date(dateStr);
  if (!isNaN(dateObj.getTime())) {
    return {
      competenceYear: dateObj.getFullYear(),
      competenceMonth: dateObj.getMonth() + 1,
    };
  }

  const now = new Date();
  return {
    competenceYear: now.getFullYear(),
    competenceMonth: now.getMonth() + 1,
  };
};

/**
 * Verifica se un determinato mese/anno è chiuso.
 * Un mese si considera chiuso se:
 * 1. Esiste un report mensile salvato in stato 'final';
 * 2. Oppure la data/ora attuale ha superato la data di chiusura automatica (1° del mese successivo).
 */
export const isMonthClosed = async (year: number, month: number): Promise<boolean> => {
  const report = await reportRepository.getByMonthYear(year, month);
  if (report && report.status === 'final') {
    return true;
  }

  const autoClosingDate = getAutomaticClosingDate(year, month);
  const now = new Date();
  return now >= autoClosingDate;
};
