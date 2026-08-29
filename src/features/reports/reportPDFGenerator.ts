import { jsPDF } from 'jspdf';
import { formatCurrency, formatDate, getMonthName } from '../../utils/formatters';
import type { IncomeEntry, Expense, Contributor, SavingPlan, Project } from '../../types';
import type { PeriodBudgetSummary } from '../../services/budgetService';
import type { SelectedPeriodRange, PeriodType } from './periodUtils';
import type { ClassificationSummaries, ReportInclusions, ReportVisualMode, ReportDetailLevel } from './EconomicReportDocument';

export interface EconomicReportPDFExportOptions {
  summary: PeriodBudgetSummary;
  selectedRange: SelectedPeriodRange;
  periodType: PeriodType;
  reportStatus: 'provisional' | 'final';
  generationDateStr: string;
  formattedAddress: string | null;
  incomes: IncomeEntry[];
  expenses: Expense[];
  contributorMap: Map<string, Contributor>;
  categoryMap: Map<string, string>;
  supplierMap?: Map<string, string>;
  upcomingPaymentsList?: Expense[];
  upcomingPaymentsSum?: number;
  classificationSummaries: ClassificationSummaries;
  savingPlans?: SavingPlan[];
  projects?: Project[];
  hasExtraBudgetData?: boolean;
  hasSavingsOrProjects?: boolean;
  isAllZeroPeriod: boolean;
  docTitle: string;
  printPeriodText: string;
  inclusions?: ReportInclusions;
  visualMode?: ReportVisualMode;
  detailLevel?: ReportDetailLevel;
}

export function formatPDFText(str: string): string {
  if (!str) return '';
  return str
    .replace(/[\u2212\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0\u202F\u2007]/g, ' ');
}

export function formatPDFCurrency(amount: number): string {
  const formatted = formatCurrency(amount);
  return formatPDFText(formatted);
}

export function buildEconomicReportPDFFileName(
  _docTitle: string,
  selectedRange: SelectedPeriodRange
): string {
  if (selectedRange.isSingleMonth) {
    const monthName = getMonthName(selectedRange.endMonth);
    return `Gestione-Casa_Report-Economico_${monthName}-${selectedRange.endYear}.pdf`;
  }
  const startMonthName = getMonthName(selectedRange.startMonth);
  const endMonthName = getMonthName(selectedRange.endMonth);
  if (selectedRange.startYear === selectedRange.endYear) {
    return `Gestione-Casa_Report-Economico_${startMonthName}-${endMonthName}-${selectedRange.endYear}.pdf`;
  }
  return `Gestione-Casa_Report-Economico_${startMonthName}-${selectedRange.startYear}_${endMonthName}-${selectedRange.endYear}.pdf`;
}

export function generateEconomicReportPDF(options: EconomicReportPDFExportOptions): jsPDF {
  const {
    summary,
    selectedRange,
    reportStatus,
    generationDateStr,
    formattedAddress,
    incomes,
    expenses,
    contributorMap,
    categoryMap,
    classificationSummaries,
    isAllZeroPeriod,
    docTitle,
    printPeriodText,
    detailLevel = 'standard',
  } = options;

  // A4 Dimensioni: 210mm x 297mm
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginLeft = 14;
  const marginRight = 14;
  const contentWidth = pageWidth - marginLeft - marginRight; // 182 mm
  const totalPages = 2;

  // Palette Colori
  const primaryColor = [79, 70, 229]; // #4F46E5 Indigo
  const textDark = [15, 23, 42]; // #0F172A Slate 900
  const textMuted = [100, 116, 139]; // #64748B Slate 500
  const textSecondary = [51, 65, 85]; // #334155 Slate 700
  const cardBg = [248, 250, 252]; // #F8FAFC
  const borderLight = [226, 232, 240]; // #E2E8F0
  const emeraldColor = [16, 185, 129];
  const roseColor = [239, 68, 68];
  const amberColor = [217, 119, 6];

  // Helper per tracking etichette e reset spazio caratteri
  doc.setCharSpace(0);

  const renderTrackedLabel = (
    text: string,
    x: number,
    y: number,
    alignOptions?: { align?: 'left' | 'center' | 'right' }
  ) => {
    doc.setCharSpace(0.3);
    doc.text(formatPDFText(text), x, y, alignOptions);
    doc.setCharSpace(0);
  };

  // Helper per footer standard
  const renderFooter = (pageNumber: number) => {
    doc.setCharSpace(0);
    doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
    doc.setLineWidth(0.3);
    doc.line(marginLeft, pageHeight - 12, pageWidth - marginRight, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text(`Gestione Casa - ${formatPDFText(docTitle)}`, marginLeft, pageHeight - 7);
    doc.text(`Pagina ${pageNumber} di ${totalPages}`, pageWidth - marginRight, pageHeight - 7, { align: 'right' });
  };

  // ==========================================
  // PAGINA 1: SINTESI ECONOMICA & BILANCIO
  // ==========================================

  // 1. Header Aziendale / Documentale
  doc.setCharSpace(0);

  // Logo GC
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.roundedRect(marginLeft, 12, 10, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('GC', marginLeft + 5, 18.5, { align: 'center' });

  // Titolo App e Documento
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('GESTIONE CASA', marginLeft + 13, 17);

  doc.setFontSize(15);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(formatPDFText(docTitle), marginLeft, 28);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(formatPDFText(printPeriodText), marginLeft, 33);

  // Metadati Destra (Abitazione, Stato, Generazione)
  let metaY = 16;
  doc.setFontSize(8);
  if (formattedAddress) {
    doc.setTextColor(textSecondary[0], textSecondary[1], textSecondary[2]);
    doc.text(`Abitazione: ${formatPDFText(formattedAddress)}`, pageWidth - marginRight, metaY, { align: 'right' });
    metaY += 4.5;
  }
  if (selectedRange.isSingleMonth) {
    const statusText = reportStatus === 'final' ? 'Definitivo' : 'Provvisorio';
    doc.setTextColor(
      reportStatus === 'final' ? emeraldColor[0] : amberColor[0],
      reportStatus === 'final' ? emeraldColor[1] : amberColor[1],
      reportStatus === 'final' ? emeraldColor[2] : amberColor[2]
    );
    doc.text(`Stato: ${statusText}`, pageWidth - marginRight, metaY, { align: 'right' });
    metaY += 4.5;
  }
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(`Generato il: ${formatPDFText(generationDateStr)}`, pageWidth - marginRight, metaY, { align: 'right' });

  // Linea divisoria header
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.setLineWidth(0.4);
  doc.line(marginLeft, 36, pageWidth - marginRight, 36);

  // 2. I 3 KPI Contabili Chiave
  const kpiY = 40;
  const kpiHeight = 22;
  const kpiGap = 4;
  const kpiWidth = (contentWidth - kpiGap * 2) / 3; // ~58mm

  // KPI 1: Totale Entrate
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, kpiY, kpiWidth, kpiHeight, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(emeraldColor[0], emeraldColor[1], emeraldColor[2]);
  renderTrackedLabel('TOTALE ENTRATE', marginLeft + 4, kpiY + 6);
  doc.setFontSize(13);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(formatPDFCurrency(summary.totalIncome), marginLeft + 4, kpiY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(selectedRange.isSingleMonth ? 'Totale mensile' : 'Totale periodo', marginLeft + 4, kpiY + 19);

  // KPI 2: Totale Uscite
  const kpi2X = marginLeft + kpiWidth + kpiGap;
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.roundedRect(kpi2X, kpiY, kpiWidth, kpiHeight, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(roseColor[0], roseColor[1], roseColor[2]);
  renderTrackedLabel('TOTALE USCITE', kpi2X + 4, kpiY + 6);
  doc.setFontSize(13);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(formatPDFCurrency(summary.totalExpenses), kpi2X + 4, kpiY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Spese sostenute e pianificate', kpi2X + 4, kpiY + 19);

  // KPI 3: Saldo del Periodo
  const kpi3X = kpi2X + kpiWidth + kpiGap;
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.roundedRect(kpi3X, kpiY, kpiWidth, kpiHeight, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  renderTrackedLabel('SALDO DEL PERIODO', kpi3X + 4, kpiY + 6);
  doc.setFontSize(13);
  const isNegativeSavings = summary.savings < 0;
  doc.setTextColor(
    isNegativeSavings ? roseColor[0] : textDark[0],
    isNegativeSavings ? roseColor[1] : textDark[1],
    isNegativeSavings ? roseColor[2] : textDark[2]
  );
  doc.text(formatPDFCurrency(summary.savings), kpi3X + 4, kpiY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(summary.savings >= 0 ? 'Surplus economico netto' : 'Disavanzo registrato', kpi3X + 4, kpiY + 19);

  // 3. Sezione Riepilogo Generale & Bilancio Prudenziale
  let currY = kpiY + kpiHeight + 6; // ~68mm
  const cardWidth = (contentWidth - 6) / 2; // ~88mm

  // Box Sinistra: Riepilogo Generale Contabile
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, currY, cardWidth, 80, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(selectedRange.isSingleMonth ? 'Riepilogo Generale' : 'Andamento per Mese', marginLeft + 4, currY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Dettaglio entrate, uscite e margine netto', marginLeft + 4, currY + 12);

  if (isAllZeroPeriod) {
    doc.setFontSize(8);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text('Nessun dato economico disponibile per il periodo.', marginLeft + 4, currY + 25);
  } else {
    let rowY = currY + 20;
    const addSummaryRow = (label: string, value: string, isBold = false, color = textDark) => {
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.setFontSize(8);
      doc.setTextColor(textSecondary[0], textSecondary[1], textSecondary[2]);
      doc.text(formatPDFText(label), marginLeft + 4, rowY);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(formatPDFText(value), marginLeft + cardWidth - 4, rowY, { align: 'right' });
      rowY += 6;
    };

    addSummaryRow('Entrate Totali:', formatPDFCurrency(summary.totalIncome), true, emeraldColor);
    addSummaryRow('Spese Pagate:', `- ${formatPDFCurrency(summary.paidExpenses)}`, false, roseColor);
    addSummaryRow('Spese Pianificate:', `- ${formatPDFCurrency(summary.totalExpenses - summary.paidExpenses)}`, false, textMuted);
    addSummaryRow('Totale Uscite:', `- ${formatPDFCurrency(summary.totalExpenses)}`, true, roseColor);

    doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
    doc.line(marginLeft + 4, rowY, marginLeft + cardWidth - 4, rowY);
    rowY += 4.5;

    addSummaryRow('Risparmio Netto:', formatPDFCurrency(summary.savings), true, summary.savings >= 0 ? emeraldColor : roseColor);
    if (summary.totalIncome > 0) {
      const coverage = Math.round(((summary.totalIncome - summary.totalExpenses) / summary.totalIncome) * 100);
      addSummaryRow('Tasso di Risparmio:', `${coverage}%`, false, textMuted);
    }
  }

  // Box Destra: Bilancio Prudenziale
  const box2X = marginLeft + cardWidth + 6;
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(box2X, currY, cardWidth, 80, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('Bilancio Prudenziale', box2X + 4, currY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Accantonamenti e quota residua reale', box2X + 4, currY + 12);

  let bpRowY = currY + 20;
  const addBPRow = (label: string, value: string, isBold = false, color = textDark) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(textSecondary[0], textSecondary[1], textSecondary[2]);
    doc.text(formatPDFText(label), box2X + 4, bpRowY);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(formatPDFText(value), box2X + cardWidth - 4, bpRowY, { align: 'right' });
    bpRowY += 5.5;
  };

  addBPRow('Entrate Ricevute:', formatPDFCurrency(summary.totalReceivedIncome), false, textDark);
  addBPRow('Spese Pagate:', `- ${formatPDFCurrency(summary.paidExpenses)}`, false, textDark);
  addBPRow('Spese Pianif. Notificate:', `- ${formatPDFCurrency(summary.notifiedPlannedExpenses)}`, false, textDark);
  addBPRow('Quote Piani Risparmio:', `- ${formatPDFCurrency(summary.savingPlanTotal)}`, false, roseColor);
  addBPRow('Quote Progetti Attivi:', `- ${formatPDFCurrency(summary.projectQuotaTotal)}`, false, roseColor);

  // Sub-box Margine Prudenziale Disponibile
  bpRowY += 2;
  doc.setFillColor(
    summary.prudentialBalance >= 0 ? 238 : 254,
    summary.prudentialBalance >= 0 ? 242 : 242,
    summary.prudentialBalance >= 0 ? 255 : 242
  );
  doc.roundedRect(box2X + 3, bpRowY, cardWidth - 6, 20, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  renderTrackedLabel('MARGINE PRUDENZIALE DISPONIBILE', box2X + 6, bpRowY + 5.5);

  doc.setFontSize(12);
  doc.setTextColor(
    summary.prudentialBalance >= 0 ? primaryColor[0] : roseColor[0],
    summary.prudentialBalance >= 0 ? primaryColor[1] : roseColor[1],
    summary.prudentialBalance >= 0 ? primaryColor[2] : roseColor[2]
  );
  doc.text(formatPDFCurrency(summary.prudentialBalance), box2X + 6, bpRowY + 12.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(
    summary.prudentialBalance >= 0
      ? 'Capacità residua senza intaccare accantonamenti.'
      : 'Attenzione: uscite e quote superano il risparmio.',
    box2X + 6,
    bpRowY + 17
  );

  // 4. Classificazione Spese (3 Livelli)
  currY += 86; // ~154mm
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, currY, contentWidth, 38, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('Classificazione Spese', marginLeft + 4, currY + 6.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Ripartizione delle uscite per livello di necessità', marginLeft + 4, currY + 11);

  const classCardWidth = (contentWidth - 12) / 3;
  const classCardY = currY + 15;
  const classCardHeight = 18;

  // Box 1: Necessarie
  doc.setFillColor(236, 253, 245); // Emerald light
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(marginLeft + 3, classCardY, classCardWidth, classCardHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(emeraldColor[0], emeraldColor[1], emeraldColor[2]);
  renderTrackedLabel('SPESE NECESSARIE', marginLeft + 6, classCardY + 5);
  const necPct = summary.totalExpenses > 0 ? Math.round((classificationSummaries.necessary / summary.totalExpenses) * 100) : 0;
  doc.text(`${necPct}%`, marginLeft + classCardWidth - 1, classCardY + 5, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(formatPDFCurrency(classificationSummaries.necessary), marginLeft + 6, classCardY + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Indispensabili e ricorrenti', marginLeft + 6, classCardY + 16);

  // Box 2: Volontarie
  const vBoxX = marginLeft + 3 + classCardWidth + 3;
  doc.setFillColor(238, 242, 255); // Indigo light
  doc.setDrawColor(199, 210, 254);
  doc.roundedRect(vBoxX, classCardY, classCardWidth, classCardHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  renderTrackedLabel('SPESE VOLONTARIE', vBoxX + 3, classCardY + 5);
  const volPct = summary.totalExpenses > 0 ? Math.round((classificationSummaries.voluntary / summary.totalExpenses) * 100) : 0;
  doc.text(`${volPct}%`, vBoxX + classCardWidth - 4, classCardY + 5, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(formatPDFCurrency(classificationSummaries.voluntary), vBoxX + 3, classCardY + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Discrezionali e stile di vita', vBoxX + 3, classCardY + 16);

  // Box 3: Da Valutare
  const evBoxX = vBoxX + classCardWidth + 3;
  doc.setFillColor(254, 243, 199); // Amber light
  doc.setDrawColor(253, 230, 138);
  doc.roundedRect(evBoxX, classCardY, classCardWidth, classCardHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(amberColor[0], amberColor[1], amberColor[2]);
  renderTrackedLabel('DA VALUTARE', evBoxX + 3, classCardY + 5);
  const evPct = summary.totalExpenses > 0 ? Math.round((classificationSummaries.toEvaluate / summary.totalExpenses) * 100) : 0;
  doc.text(`${evPct}%`, evBoxX + classCardWidth - 4, classCardY + 5, { align: 'right' });
  doc.setFontSize(11);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(formatPDFCurrency(classificationSummaries.toEvaluate), evBoxX + 3, classCardY + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Spese straordinarie / ottimizzabili', evBoxX + 3, classCardY + 16);

  // 5. Sintesi ed Osservazioni Economiche
  currY += 44; // ~198mm
  doc.setFillColor(238, 242, 255);
  doc.setDrawColor(199, 210, 254);
  doc.roundedRect(marginLeft, currY, contentWidth, 34, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('Sintesi ed Osservazioni Economiche', marginLeft + 4, currY + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(textSecondary[0], textSecondary[1], textSecondary[2]);

  let observationText = '';
  if (summary.totalIncome === 0 && summary.totalExpenses === 0) {
    observationText = 'Nel periodo esaminato non risultano registrati movimenti contabili attivi.';
  } else if (summary.savings >= 0) {
    const coverage = summary.totalIncome > 0 ? Math.round(((summary.totalIncome - summary.totalExpenses) / summary.totalIncome) * 100) : 0;
    observationText = `Nel periodo esaminato le entrate (${formatPDFCurrency(summary.totalIncome)}) superano le uscite complessive (${formatPDFCurrency(summary.totalExpenses)}), generando un saldo positivo di ${formatPDFCurrency(summary.savings)}. La copertura delle spese si attesta al ${coverage}%. Il margine prudenziale disponibile ammonta a ${formatPDFCurrency(summary.prudentialBalance)}.`;
  } else {
    observationText = `Nel periodo esaminato le uscite (${formatPDFCurrency(summary.totalExpenses)}) superano le entrate (${formatPDFCurrency(summary.totalIncome)}), evidenziando un disavanzo di ${formatPDFCurrency(Math.abs(summary.savings))}. Si raccomanda di valutare l'impiego della riserva di sicurezza o la riduzione delle spese non essenziali.`;
  }

  const splitObs = doc.splitTextToSize(formatPDFText(observationText), contentWidth - 8);
  doc.text(splitObs, marginLeft + 4, currY + 13);

  // Footer Pagina 1
  renderFooter(1);

  // ==========================================
  // PAGINA 2: DETTAGLI E RIPARTIZIONI
  // ==========================================
  doc.addPage('a4', 'portrait');
  doc.setCharSpace(0);

  // Header Pagina 2
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, 12, contentWidth, 15, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text(`${formatPDFText(docTitle)} - Dettagli e Ripartizioni`, marginLeft + 4, 18.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(formatPDFText(printPeriodText), marginLeft + 4, 23.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(`Pagina 2 di ${totalPages}`, pageWidth - marginRight - 4, 21, { align: 'right' });

  let p2Y = 32;

  // 1. Ripartizione Uscite per Categoria
  const nonZeroCategories = (summary.expensesByCategory || []).filter((c) => c.amount > 0);
  const catBoxHeight = 58;
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, p2Y, contentWidth, catBoxHeight, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('Ripartizione Uscite per Categoria', marginLeft + 4, p2Y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(`Distribuzione delle spese tra le categorie registrate (${nonZeroCategories.length} attive)`, marginLeft + 4, p2Y + 10.5);

  if (nonZeroCategories.length === 0) {
    doc.setFontSize(8);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text('Nessuna uscita registrata per categoria nel periodo.', marginLeft + 4, p2Y + 22);
  } else {
    // Tabella compatta a 2 colonne di categorie
    let catRowY = p2Y + 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    renderTrackedLabel('CATEGORIA', marginLeft + 4, catRowY);
    renderTrackedLabel('INCIDENZA', marginLeft + 70, catRowY, { align: 'center' });
    renderTrackedLabel('IMPORTO', marginLeft + 115, catRowY, { align: 'right' });

    doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
    doc.line(marginLeft + 4, catRowY + 2, marginLeft + contentWidth - 4, catRowY + 2);
    catRowY += 6;

    nonZeroCategories.slice(0, 6).forEach((cat) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      doc.text(formatPDFText(cat.categoryName), marginLeft + 4, catRowY);

      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text(`${cat.percentage}%`, marginLeft + 70, catRowY, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      doc.text(formatPDFCurrency(cat.amount), marginLeft + 115, catRowY, { align: 'right' });

      // Barra di avanzamento grafica
      doc.setFillColor(borderLight[0], borderLight[1], borderLight[2]);
      doc.roundedRect(marginLeft + 125, catRowY - 2.5, 50, 3, 1, 1, 'F');
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      const barW = Math.min(50, (cat.percentage / 100) * 50);
      if (barW > 0) {
        doc.roundedRect(marginLeft + 125, catRowY - 2.5, barW, 3, 1, 1, 'F');
      }

      catRowY += 5.5;
    });
  }

  // 2. Analisi Acquisti Ordinari e Scontrini
  p2Y += catBoxHeight + 5; // ~95mm
  const expBoxHeight = 65;
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, p2Y, contentWidth, expBoxHeight, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('Analisi Acquisti Ordinari e Scontrini', marginLeft + 4, p2Y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text(`Riepilogo delle spese di consumo registrate (${expenses.length} movimenti)`, marginLeft + 4, p2Y + 10.5);

  if (expenses.length === 0) {
    doc.setFontSize(8);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text('Nessun acquisto registrato nel periodo.', marginLeft + 4, p2Y + 22);
  } else {
    let expRowY = p2Y + 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    renderTrackedLabel('DESCRIZIONE', marginLeft + 4, expRowY);
    renderTrackedLabel('DATA', marginLeft + 80, expRowY);
    renderTrackedLabel('CATEGORIA', marginLeft + 110, expRowY);
    renderTrackedLabel('IMPORTO', marginLeft + contentWidth - 4, expRowY, { align: 'right' });

    doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
    doc.line(marginLeft + 4, expRowY + 2, marginLeft + contentWidth - 4, expRowY + 2);
    expRowY += 6;

    const maxRows = detailLevel === 'detailed' ? 10 : 7;
    expenses.slice(0, maxRows).forEach((exp) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      const desc = exp.description.length > 35 ? `${exp.description.substring(0, 32)}...` : exp.description;
      doc.text(formatPDFText(desc), marginLeft + 4, expRowY);

      doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
      doc.text(formatDate(exp.expenseDate), marginLeft + 80, expRowY);

      const catName = categoryMap.get(exp.categoryId) || 'Generale';
      const catTrunc = catName.length > 18 ? `${catName.substring(0, 16)}...` : catName;
      doc.text(formatPDFText(catTrunc), marginLeft + 110, expRowY);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(roseColor[0], roseColor[1], roseColor[2]);
      doc.text(formatPDFCurrency(exp.amount), marginLeft + contentWidth - 4, expRowY, { align: 'right' });

      expRowY += 5.2;
    });
  }

  // 3. Ripartizione Contributori
  p2Y += expBoxHeight + 5; // ~165mm
  const contribBoxHeight = 45;
  doc.setFillColor(cardBg[0], cardBg[1], cardBg[2]);
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.roundedRect(marginLeft, p2Y, contentWidth, contribBoxHeight, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(textDark[0], textDark[1], textDark[2]);
  doc.text('Ripartizione Contributori', marginLeft + 4, p2Y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text('Quote di partecipazione economica dei componenti della casa', marginLeft + 4, p2Y + 10.5);

  const contribList = Array.from(contributorMap.values());
  if (incomes.length === 0 || contribList.length === 0) {
    doc.setFontSize(8);
    doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
    doc.text('Nessun dato di contribuzione disponibile.', marginLeft + 4, p2Y + 22);
  } else {
    const cCardWidth = (contentWidth - 8 - (contribList.length - 1) * 4) / Math.max(1, Math.min(3, contribList.length));
    let cX = marginLeft + 4;
    const cY = p2Y + 15;

    contribList.slice(0, 3).forEach((contrib) => {
      const contribIncomes = incomes.filter((inc) => inc.contributorId === contrib.id);
      const totalContrib = contribIncomes.reduce((s, inc) => s + inc.amount, 0);
      const pct = summary.totalIncome > 0 ? Math.round((totalContrib / summary.totalIncome) * 100) : 0;

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
      doc.roundedRect(cX, cY, cCardWidth, 23, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(textDark[0], textDark[1], textDark[2]);
      doc.text(formatPDFText(contrib.name), cX + 3, cY + 5.5);

      doc.setFontSize(7.5);
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(`${pct}%`, cX + cCardWidth - 3, cY + 5.5, { align: 'right' });

      doc.setFontSize(10);
      doc.setTextColor(emeraldColor[0], emeraldColor[1], emeraldColor[2]);
      doc.text(formatPDFCurrency(totalContrib), cX + 3, cY + 13);

      doc.setFillColor(borderLight[0], borderLight[1], borderLight[2]);
      doc.roundedRect(cX + 3, cY + 16.5, cCardWidth - 6, 2.5, 1, 1, 'F');
      doc.setFillColor(emeraldColor[0], emeraldColor[1], emeraldColor[2]);
      const bW = Math.min(cCardWidth - 6, (pct / 100) * (cCardWidth - 6));
      if (bW > 0) {
        doc.roundedRect(cX + 3, cY + 16.5, bW, 2.5, 1, 1, 'F');
      }

      cX += cCardWidth + 4;
    });
  }

  // 4. Note di Chiusura e Certificazione
  p2Y += contribBoxHeight + 5; // ~215mm
  doc.setDrawColor(borderLight[0], borderLight[1], borderLight[2]);
  doc.line(marginLeft, p2Y, pageWidth - marginRight, p2Y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(textSecondary[0], textSecondary[1], textSecondary[2]);
  doc.text(`Gestione Casa - ${formatPDFText(docTitle)}`, pageWidth / 2, p2Y + 5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(textMuted[0], textMuted[1], textMuted[2]);
  doc.text("Documento generato automaticamente sulla base dei dati registrati nell'applicazione.", pageWidth / 2, p2Y + 9, { align: 'center' });
  doc.text(`Generato il ${formatPDFText(generationDateStr)}`, pageWidth / 2, p2Y + 13, { align: 'center' });

  // Footer Pagina 2
  renderFooter(2);

  return doc;
}

export function downloadEconomicReportPDF(options: EconomicReportPDFExportOptions): void {
  const doc = generateEconomicReportPDF(options);
  const fileName = buildEconomicReportPDFFileName(options.docTitle, options.selectedRange);
  doc.save(fileName);
}

