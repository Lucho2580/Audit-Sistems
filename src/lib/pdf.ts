import { jsPDF } from 'jspdf';
import {
  STATUS_META, MEETING_STATE_META, RESP_LABEL,
  type Project, type Meeting, type Section,
} from '../types/domain';

const PDF_C = {
  ink: [28, 31, 35] as [number, number, number],
  slate: [107, 113, 120] as [number, number, number],
  hairline: [224, 221, 217] as [number, number, number],
  paper: [244, 243, 241] as [number, number, number],
  brand: [227, 6, 19] as [number, number, number],
};
const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 40, CONTENT_W = PAGE_W - MARGIN * 2;

function trunc(s: string | undefined, n: number) {
  s = s || '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function nowStr() {
  return new Date().toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function pdfHeader(doc: jsPDF, eyebrow: string, title: string, metaLines: string[]) {
  doc.setFillColor(...PDF_C.ink); doc.rect(0, 0, PAGE_W, 72, 'F');
  doc.setFillColor(...PDF_C.brand); doc.rect(0, 72, PAGE_W, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(eyebrow.toUpperCase(), MARGIN, 26);
  doc.setFont('times', 'bold'); doc.setFontSize(17);
  doc.text(title, MARGIN, 50);
  doc.setTextColor(...PDF_C.ink);
  let y = 96;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  metaLines.forEach((line) => { doc.text(line, MARGIN, y); y += 13; });
  return y + 8;
}
function pdfCheckPage(doc: jsPDF, y: number, needed: number) {
  if (y + needed > PAGE_H - 50) { doc.addPage(); return 50; }
  return y;
}
function pdfSectionTitle(doc: jsPDF, y: number, text: string) {
  y = pdfCheckPage(doc, y, 40);
  doc.setDrawColor(...PDF_C.ink); doc.setLineWidth(1);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(...PDF_C.ink);
  doc.text(text, MARGIN, y + 16);
  return y + 28;
}
function pdfParagraph(doc: jsPDF, y: number, text: string | undefined) {
  const lines = doc.splitTextToSize(text && text.trim() ? text : '—', CONTENT_W);
  y = pdfCheckPage(doc, y, lines.length * 13 + 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...PDF_C.ink);
  doc.text(lines, MARGIN, y);
  return y + lines.length * 13 + 12;
}
function pdfTableHeader(doc: jsPDF, y: number, headers: string[], colX: number[]) {
  y = pdfCheckPage(doc, y, 24);
  doc.setFillColor(...PDF_C.ink); doc.rect(MARGIN, y - 11, CONTENT_W, 17, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(255, 255, 255);
  headers.forEach((h, i) => doc.text(h, colX[i], y));
  return y + 14;
}
function pdfTableRow(doc: jsPDF, y: number, cells: (string | number)[], colX: number[], shaded: boolean) {
  y = pdfCheckPage(doc, y, 18);
  if (shaded) { doc.setFillColor(...PDF_C.paper); doc.rect(MARGIN, y - 10, CONTENT_W, 16, 'F'); }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...PDF_C.ink);
  cells.forEach((c, i) => doc.text(String(c), colX[i], y));
  doc.setDrawColor(...PDF_C.hairline); doc.line(MARGIN, y + 6, PAGE_W - MARGIN, y + 6);
  return y + 16;
}
function pdfChecklistWithLog(doc: jsPDF, y: number, sec: Section) {
  const headers = ['Código', 'Checkpoint', 'Responsable', 'Avance', 'Seguim.'];
  const colX = [MARGIN, MARGIN + 55, MARGIN + 330, MARGIN + 415, MARGIN + 460];
  y = pdfTableHeader(doc, y, headers, colX);
  sec.items.forEach((it, i) => {
    const logLines: string[] = [];
    it.log.forEach((l) => {
      const wrapped = doc.splitTextToSize(
        `↳ ${new Date(l.createdAt).toLocaleDateString('es-ES')} — ${l.text}`,
        CONTENT_W - (colX[1] - MARGIN) - 10,
      );
      wrapped.forEach((w: string) => logLines.push(w));
    });
    const rowH = 16 + logLines.length * 11;
    y = pdfCheckPage(doc, y, rowH + 4);
    if (i % 2 === 1) { doc.setFillColor(...PDF_C.paper); doc.rect(MARGIN, y - 10, CONTENT_W, rowH, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...PDF_C.ink);
    doc.text(`${sec.code}-${String(it.n).padStart(2, '0')}`, colX[0], y);
    doc.text(trunc(it.text, 58), colX[1], y);
    doc.text(RESP_LABEL[it.resp], colX[2], y);
    doc.text(it.percent + '%', colX[3], y);
    doc.text(String(it.log.length), colX[4], y);
    let innerY = y + 12;
    if (logLines.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.4); doc.setTextColor(...PDF_C.slate);
      doc.text(logLines, colX[1], innerY);
      innerY += logLines.length * 11;
    }
    doc.setDrawColor(...PDF_C.hairline); doc.line(MARGIN, innerY, PAGE_W - MARGIN, innerY);
    y = innerY + 10;
  });
  return y;
}
function pdfFooterAll(doc: jsPDF) {
  const n = doc.internal.pages.length - 1;
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...PDF_C.slate);
    doc.text(`Sistema de auditoría de desarrollo · Generado el ${nowStr()}`, MARGIN, PAGE_H - 30);
    doc.text(`Página ${i} de ${n}`, PAGE_W - MARGIN - 70, PAGE_H - 30);
  }
}

export function generateProjectReportPdf(project: Project, meetings: Meeting[]) {
  const stats = project.stats ?? { total: 0, done: 0, prog: 0, pend: 0, pct: 0 };
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = pdfHeader(doc, 'Informe de auditoría · Levantamiento técnico', project.name, [
    `Código: ${project.code}   ·   Proveedor: ${project.proveedor}   ·   Estado: ${STATUS_META[project.status]}`,
    `Avance total: ${stats.pct}%   (${stats.done} completados, ${stats.prog} en progreso, ${stats.pend} pendientes)`,
  ]);

  project.sections.forEach((sec) => {
    const secTotal = sec.items.length;
    const secPct = secTotal ? Math.round(sec.items.reduce((a, i) => a + i.percent, 0) / secTotal) : 0;
    y = pdfSectionTitle(doc, y, `${sec.code} — ${sec.title} (${secPct}%)`);
    y = pdfChecklistWithLog(doc, y, sec);
    y += 8;
    if (sec.notes && sec.notes.trim()) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...PDF_C.slate);
      y = pdfCheckPage(doc, y, 14); doc.text('NOTAS DE LA SECCIÓN', MARGIN, y); y += 12;
      y = pdfParagraph(doc, y, sec.notes);
    }
  });

  y = pdfSectionTitle(doc, y, 'Calendario de reuniones');
  if (meetings.length) {
    const headers = ['Fecha', 'Hora', 'Reunión', 'Estado', 'Participantes'];
    const colX = [MARGIN, MARGIN + 65, MARGIN + 110, MARGIN + 300, MARGIN + 375];
    y = pdfTableHeader(doc, y, headers, colX);
    meetings
      .slice()
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .forEach((mt, i) => {
        y = pdfTableRow(
          doc, y,
          [mt.date, mt.time, trunc(mt.title || '—', 30), MEETING_STATE_META[mt.state],
            trunc((mt.participants || []).map((p) => p.label).join(', ') || '—', 22)],
          colX, i % 2 === 1,
        );
      });
  } else {
    y = pdfParagraph(doc, y, 'No hay reuniones agendadas para este proyecto.');
  }

  pdfFooterAll(doc);
  doc.save(`informe_${project.code}.pdf`);
}

