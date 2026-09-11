// Genera el acta de reunión con el formato institucional (FO-GT-018): arma
// el documento como HTML real (no dibujado a mano como el resto de pdf.ts)
// para poder replicar fielmente paneles de color y tablas con bordes, y lo
// rasteriza a PDF con html2canvas -- jsPDF por sí solo no puede renderizar
// CSS. La aprobación no pide firma manuscrita: se llena sola con los
// participantes reales de la reunión (por eso no hay campos de firma).
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import laViandaBlanco from '../assets/lavianda-blanco.png';
import { STATUS_META, type Project, type Meeting } from '../types/domain';

const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function lines(text: string | null | undefined): string[] {
  return (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function addOneHour(time: string): string {
  const [h, m] = time.split(':').map((n) => parseInt(n, 10));
  const total = (h || 0) * 60 + (m || 0) + 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function fieldCell(label: string, value: string, opts: { span?: number; borderLeft?: boolean; red?: boolean } = {}): string {
  return `
    <div style="padding:9px 14px;border-top:1px solid #201f1d;${opts.borderLeft ? 'border-left:1px solid #201f1d;' : ''}${opts.span ? `grid-column:span ${opts.span};` : ''}">
      <div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">${esc(label)}</div>
      <div style="font-family:'Fraunces',serif;font-size:14px;margin-top:4px;${opts.red ? 'color:#c00510;' : ''}">${esc(value) || '—'}</div>
    </div>`;
}

function sectionBanner(title: string): string {
  return `<div style="background:#e30613;color:#ffffff;padding:7px 14px;font-size:9.5px;letter-spacing:.2em;text-transform:uppercase">${esc(title)}</div>`;
}

function roleFor(project: Project, name: string): string {
  if (name === project.jefeNombre) return 'Jefe de proyecto';
  if (name === project.responsableNombre) return 'Persona asignada';
  if (name === project.proveedor) return 'Proveedor';
  if (project.clientes.some((c) => c.nombre === name)) return 'Cliente';
  return 'Invitado';
}

function buildActaHtml(project: Project, meeting: Meeting): string {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const actaNo = `ACT-${meeting.date.replace(/-/g, '')}-${meeting.id.slice(0, 4).toUpperCase()}`;

  const fields = [
    fieldCell('Acta n.º', actaNo),
    fieldCell('Proyecto', project.name, { span: 2, borderLeft: true }),
    fieldCell('Código del proyecto', project.code, { borderLeft: true }),
    fieldCell('Fecha', new Date(meeting.date + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })),
    fieldCell('Hora de inicio', meeting.time, { borderLeft: true }),
    fieldCell('Hora de cierre', addOneHour(meeting.time), { borderLeft: true }),
    fieldCell('Modalidad', meeting.modalidad || 'Microsoft Teams', { borderLeft: true }),
    fieldCell('Tipo de reunión', meeting.title || 'Reunión de seguimiento'),
    fieldCell('Fase actual', STATUS_META[project.status], { borderLeft: true, red: true }),
  ].join('');

  const attendeeRows = meeting.participants.length
    ? meeting.participants.map((p) => `
      <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.2fr) 90px;border-top:1px solid #201f1d">
        <div style="padding:8px 14px;font-size:11.5px;border-right:1px solid #201f1d">${esc(p.label)}</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#4A4F56;border-right:1px solid #201f1d">${esc(roleFor(project, p.label))}</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#4A4F56;border-right:1px solid #201f1d">${esc(project.name)}</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#c00510">Sí</div>
      </div>`).join('')
    : `<div style="padding:10px 14px;font-size:11.5px;color:#6B7178;font-style:italic;border-top:1px solid #201f1d">Sin participantes registrados.</div>`;

  const agendaItems = lines(meeting.topics);
  const agendaRows = agendaItems.length
    ? agendaItems.map((text, i) => `
      <div style="display:grid;grid-template-columns:44px minmax(0,1fr);border-top:1px solid #201f1d">
        <div style="padding:8px 0;text-align:center;font-size:11px;color:#6B7178;border-right:1px solid #201f1d">${String(i + 1).padStart(2, '0')}</div>
        <div style="padding:8px 14px;font-size:11.5px;line-height:1.6">${esc(text)}</div>
      </div>`).join('')
    : `<div style="padding:10px 14px;font-size:11.5px;color:#6B7178;font-style:italic;border-top:1px solid #201f1d">Sin agenda registrada.</div>`;

  const devParagraphs = lines(meeting.agreements);
  const devHtml = devParagraphs.length
    ? devParagraphs.map((p) => `<p style="margin:0 0 9px;font-size:12px;line-height:1.7;text-align:justify">${esc(p)}</p>`).join('')
    : `<p style="margin:0;font-size:12px;line-height:1.7;color:#6B7178;font-style:italic">Sin desarrollo registrado para esta reunión.</p>`;

  const commitmentItems = lines(meeting.nextSteps);
  const commitmentRows = commitmentItems.length
    ? commitmentItems.map((text, i) => `
      <div style="display:grid;grid-template-columns:36px minmax(0,1.7fr) minmax(0,1fr) 104px;border-top:1px solid #201f1d">
        <div style="padding:8px 0;text-align:center;font-size:11px;color:#6B7178;border-right:1px solid #201f1d">${String(i + 1).padStart(2, '0')}</div>
        <div style="padding:8px 14px;font-size:11.5px;line-height:1.6;border-right:1px solid #201f1d">${esc(text)}</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#4A4F56;border-right:1px solid #201f1d">—</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#c00510">—</div>
      </div>`).join('')
    : `<div style="padding:10px 14px;font-size:11.5px;color:#6B7178;font-style:italic;border-top:1px solid #201f1d">Sin compromisos registrados.</div>`;

  const obsText = (meeting.risks ?? '').trim();

  const approvalCandidates = [
    { role: 'Elaborada por', name: project.responsableNombre },
    { role: 'Revisada por', name: project.jefeNombre },
    { role: 'Aprobada por', name: project.proveedor },
  ].filter((c) => c.name && meeting.participants.some((p) => p.label === c.name));
  const approvals = [
    ...approvalCandidates.map((c) => ({ role: c.role, name: c.name as string, meta: hoy })),
    { role: 'Fecha de aprobación', name: hoy, meta: 'Registrada en el sistema' },
  ];
  const approvalRows = approvals.map((a, i) => `
    <div style="padding:10px 14px;${i === 0 ? '' : 'border-left:1px solid #201f1d;'}">
      <div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">${esc(a.role)}</div>
      <div style="font-family:'Fraunces',serif;font-size:14px;margin-top:4px">${esc(a.name)}</div>
      <div style="font-size:10px;color:#6B7178;margin-top:2px">${esc(a.meta)}</div>
    </div>`).join('');

  return `
    <div style="font-family:'Inter',sans-serif;color:#201f1d;border:1px solid #201f1d;background:#ffffff">
      <div style="display:grid;grid-template-columns:150px minmax(0,1fr) 150px;border-bottom:1px solid #201f1d">
        <div style="background:#e30613;display:flex;align-items:center;justify-content:center;padding:12px 14px">
          <img src="${laViandaBlanco}" alt="La Vianda" style="display:block;width:100%;max-width:104px;height:auto">
        </div>
        <div style="border-left:1px solid #201f1d;border-right:1px solid #201f1d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:14px 16px;text-align:center">
          <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#c00510">Gestión de tecnología</div>
          <h1 style="margin:0;font-family:'Fraunces',serif;font-weight:400;font-size:23px;line-height:1.15">Acta de reunión de seguimiento de proyectos de software</h1>
        </div>
        <div style="display:grid;grid-template-rows:repeat(3,1fr)">
          ${[['Código', 'FO-GT-018'], ['Versión', '01'], ['Fecha', hoy]].map(([l, v], i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;${i === 0 ? '' : 'border-top:1px solid #201f1d;'}">
              <span style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">${l}</span>
              <span style="font-size:11px">${v}</span>
            </div>`).join('')}
        </div>
      </div>

      ${sectionBanner('Datos de la reunión')}
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr))">${fields}</div>

      <div style="border-top:1px solid #201f1d">
        ${sectionBanner('Asistentes')}
        <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.2fr) 90px;border-top:1px solid #201f1d;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">
          <div style="padding:7px 14px;border-right:1px solid #201f1d">Nombre</div>
          <div style="padding:7px 14px;border-right:1px solid #201f1d">Rol</div>
          <div style="padding:7px 14px;border-right:1px solid #201f1d">Entidad / área</div>
          <div style="padding:7px 14px">Asistió</div>
        </div>
        ${attendeeRows}
      </div>

      <div style="border-top:1px solid #201f1d">
        ${sectionBanner('Orden del día')}
        ${agendaRows}
      </div>

      <div style="border-top:1px solid #201f1d">
        ${sectionBanner('Desarrollo de la reunión')}
        <div style="padding:14px;border-top:1px solid #201f1d">${devHtml}</div>
      </div>

      <div style="border-top:1px solid #201f1d">
        ${sectionBanner('Compromisos')}
        <div style="display:grid;grid-template-columns:36px minmax(0,1.7fr) minmax(0,1fr) 104px;border-top:1px solid #201f1d;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">
          <div style="padding:7px 0;text-align:center;border-right:1px solid #201f1d">N.º</div>
          <div style="padding:7px 14px;border-right:1px solid #201f1d">Compromiso</div>
          <div style="padding:7px 14px;border-right:1px solid #201f1d">Responsable</div>
          <div style="padding:7px 14px">Fecha límite</div>
        </div>
        ${commitmentRows}
      </div>

      <div style="border-top:1px solid #201f1d">
        ${sectionBanner('Observaciones')}
        <div style="padding:14px;border-top:1px solid #201f1d">
          <p style="margin:0;font-size:12px;line-height:1.7;text-align:justify${obsText ? '' : ';color:#6B7178;font-style:italic'}">${esc(obsText) || 'Sin riesgos u observaciones registrados.'}</p>
        </div>
      </div>

      <div style="border-top:1px solid #201f1d">
        ${sectionBanner('Aprobación del acta')}
        <div style="display:grid;grid-template-columns:repeat(${approvals.length},minmax(0,1fr));border-top:1px solid #201f1d">
          ${approvalRows}
        </div>
        <div style="padding:9px 14px;border-top:1px solid #201f1d;font-size:10px;color:#6B7178;font-style:italic">Aprobación registrada en el sistema de auditoría con la cuenta de cada rol. No requiere firma manuscrita.</div>
      </div>

      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:7px 14px;border-top:1px solid #201f1d;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#6B7178">
        <span>Sistema de auditoría · Desarrollo de software</span>
        <span>FO-GT-018 · Versión 01</span>
      </div>
    </div>`;
}

// html2canvas no siempre espera a que las <img> agregadas vía innerHTML
// terminen de cargar (sobre todo en build de producción, con el asset
// servido por red en vez de cacheado) -- sin esto, el logo salía en blanco.
function waitForImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

async function renderHtmlToPdf(html: string, filename: string): Promise<Blob> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '780px';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    await waitForImages(container);
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    let heightLeft = imgH;
    let position = 0;
    doc.addImage(imgData, 'PNG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      doc.addPage();
      doc.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    doc.save(filename);
    return doc.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

// Devuelve el PDF generado (además de descargarlo) para que quien llama
// pueda además subirlo a Supabase Storage -- ver ActasApi.upload en
// lib/services.ts, usado desde MeetingsCalendar justo después de esto.
export async function generateMeetingActaPdf(project: Project, meeting: Meeting): Promise<Blob> {
  const html = buildActaHtml(project, meeting);
  return renderHtmlToPdf(html, `acta_${project.code}_${meeting.date}.pdf`);
}
