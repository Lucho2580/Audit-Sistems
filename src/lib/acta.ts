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

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
  if (project.jefes.some((j) => j.nombre === name)) return 'Jefe de proyecto';
  if (name === project.responsableNombre) return 'Persona asignada';
  if (name === project.proveedor) return 'Proveedor';
  if (project.clientes.some((c) => c.nombre === name)) return 'Cliente';
  return 'Invitado';
}

// Cada sección se captura por separado (ver renderBlocksToPdf) para que el
// salto de página nunca caiga a la mitad de un párrafo o una fila de tabla
// -- antes todo el documento se rasterizaba de una sola vez y se rebanaba
// cada alto de página fijo, sin importar qué texto quedara justo ahí.
function wrapBlock(html: string, opts: { first?: boolean; last?: boolean } = {}): string {
  const borders = [
    'border-left:1px solid #201f1d',
    'border-right:1px solid #201f1d',
    opts.first ? 'border-top:1px solid #201f1d' : '',
    opts.last ? 'border-bottom:1px solid #201f1d' : '',
  ].filter(Boolean).join(';');
  return `<div style="font-family:'Inter',sans-serif;color:#201f1d;background:#ffffff;${borders}">${html}</div>`;
}

function buildActaBlocks(project: Project, meeting: Meeting): string[] {
  const hoy = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const actaNo = `ACT-${meeting.date.replace(/-/g, '')}-${meeting.id.slice(0, 4).toUpperCase()}`;

  const fields = [
    fieldCell('Acta n.º', actaNo),
    fieldCell('Proyecto', project.name, { span: 2, borderLeft: true }),
    fieldCell('Código del proyecto', project.code, { borderLeft: true }),
    fieldCell('Fecha', fmtDate(meeting.date)),
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
        <div style="padding:8px 14px;font-size:11.5px;color:${p.attended ? '#c00510' : '#6B7178'}">${p.attended ? 'Sí' : 'No'}</div>
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

  const commitmentRows = meeting.compromisos.length
    ? meeting.compromisos.map((c, i) => `
      <div style="display:grid;grid-template-columns:36px minmax(0,1.7fr) minmax(0,1fr) 104px;border-top:1px solid #201f1d">
        <div style="padding:8px 0;text-align:center;font-size:11px;color:#6B7178;border-right:1px solid #201f1d">${String(i + 1).padStart(2, '0')}</div>
        <div style="padding:8px 14px;font-size:11.5px;line-height:1.6;border-right:1px solid #201f1d">${esc(c.text)}</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#4A4F56;border-right:1px solid #201f1d">${esc(c.responsable) || '—'}</div>
        <div style="padding:8px 14px;font-size:11.5px;color:#c00510">${fmtDate(c.fechaLimite)}</div>
      </div>`).join('')
    : `<div style="padding:10px 14px;font-size:11.5px;color:#6B7178;font-style:italic;border-top:1px solid #201f1d">Sin compromisos registrados.</div>`;

  const obsText = (meeting.risks ?? '').trim();

  // La aprobación solo se llena cuando TODOS los participantes ya firmaron
  // -- antes se armaba con solo estar en la lista de participantes, sin
  // importar si habían firmado o no.
  const allSigned = meeting.participants.length > 0 && meeting.participants.every((p) => p.signature);
  let approvalSection: string;
  if (allSigned) {
    const findSigner = (name: string | null) => (name ? meeting.participants.find((p) => p.label === name) : undefined);
    const approvalCandidates = [
      { role: 'Elaborada por', signer: findSigner(project.responsableNombre) },
      ...project.jefes.map((j) => ({ role: 'Revisada por', signer: findSigner(j.nombre) })),
      { role: 'Aprobada por', signer: findSigner(project.proveedor) },
    ].filter((c): c is { role: string; signer: NonNullable<typeof c.signer> } => !!c.signer);
    const latestSignedAt = meeting.participants.reduce<string | null>(
      (latest, p) => (p.signedAt && (!latest || p.signedAt > latest) ? p.signedAt : latest),
      null,
    );
    const approvals = [
      ...approvalCandidates.map((c) => ({ role: c.role, name: c.signer.label, meta: fmtDateTime(c.signer.signedAt) })),
      { role: 'Fecha de aprobación', name: fmtDateTime(latestSignedAt), meta: 'Registrada en el sistema' },
    ];
    const approvalRows = approvals.map((a, i) => `
      <div style="padding:10px 14px;${i === 0 ? '' : 'border-left:1px solid #201f1d;'}">
        <div style="font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">${esc(a.role)}</div>
        <div style="font-family:'Fraunces',serif;font-size:14px;margin-top:4px">${esc(a.name)}</div>
        <div style="font-size:10px;color:#6B7178;margin-top:2px">${esc(a.meta)}</div>
      </div>`).join('');
    approvalSection = `
      <div style="display:grid;grid-template-columns:repeat(${approvals.length},minmax(0,1fr))">
        ${approvalRows}
      </div>
      <div style="padding:9px 14px;border-top:1px solid #201f1d;font-size:10px;color:#6B7178;font-style:italic">Aprobación registrada en el sistema de auditoría, confirmada con la firma de cada participante.</div>`;
  } else {
    const signedCount = meeting.participants.filter((p) => p.signature).length;
    approvalSection = `
      <div style="padding:14px;font-size:12px;color:#6B7178;font-style:italic">
        Pendiente de firmas (${signedCount} de ${meeting.participants.length} participantes ya firmaron). El acta queda aprobada cuando todos hayan firmado.
      </div>`;
  }

  const header = `
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
    </div>`;

  return [
    wrapBlock(header, { first: true }),
    wrapBlock(`
      ${sectionBanner('Datos de la reunión')}
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr))">${fields}</div>`),
    wrapBlock(`
      ${sectionBanner('Asistentes')}
      <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.2fr) 90px;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">
        <div style="padding:7px 14px;border-right:1px solid #201f1d">Nombre</div>
        <div style="padding:7px 14px;border-right:1px solid #201f1d">Rol</div>
        <div style="padding:7px 14px;border-right:1px solid #201f1d">Entidad / área</div>
        <div style="padding:7px 14px">Asistió</div>
      </div>
      ${attendeeRows}`),
    wrapBlock(`${sectionBanner('Orden del día')}${agendaRows}`),
    wrapBlock(`
      ${sectionBanner('Desarrollo de la reunión')}
      <div style="padding:14px">${devHtml}</div>`),
    wrapBlock(`
      ${sectionBanner('Compromisos')}
      <div style="display:grid;grid-template-columns:36px minmax(0,1.7fr) minmax(0,1fr) 104px;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#6B7178">
        <div style="padding:7px 0;text-align:center;border-right:1px solid #201f1d">N.º</div>
        <div style="padding:7px 14px;border-right:1px solid #201f1d">Compromiso</div>
        <div style="padding:7px 14px;border-right:1px solid #201f1d">Responsable</div>
        <div style="padding:7px 14px">Fecha límite</div>
      </div>
      ${commitmentRows}`),
    wrapBlock(`
      ${sectionBanner('Observaciones')}
      <div style="padding:14px">
        <p style="margin:0;font-size:12px;line-height:1.7;text-align:justify${obsText ? '' : ';color:#6B7178;font-style:italic'}">${esc(obsText) || 'Sin riesgos u observaciones registrados.'}</p>
      </div>`),
    wrapBlock(`
      ${sectionBanner('Aprobación del acta')}
      ${approvalSection}`),
    wrapBlock(`
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:7px 14px;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#6B7178">
        <span>Sistema de auditoría · Desarrollo de software</span>
        <span>FO-GT-018 · Versión 01</span>
      </div>`, { last: true }),
  ];
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

async function captureBlock(html: string): Promise<HTMLCanvasElement> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '780px';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    await waitForImages(container);
    return await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  } finally {
    document.body.removeChild(container);
  }
}

// Cada bloque (sección del acta) se captura y se coloca aparte, avanzando un
// cursor Y en el PDF: si no cabe entero en lo que queda de la página actual,
// salta de página ANTES de dibujarlo -- así ninguna sección queda cortada a
// la mitad entre dos páginas. Solo si un bloque por sí solo es más alto que
// una página completa (poco común: un desarrollo o compromisos larguísimos)
// se recurre al recorte por altura fija, igual que antes, únicamente para
// ese bloque.
async function renderBlocksToPdf(blocks: string[], filename: string): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 0;

  for (const blockHtml of blocks) {
    const canvas = await captureBlock(blockHtml);
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    if (imgH > pageH) {
      if (y > 0) doc.addPage();
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
      doc.addPage();
      y = 0;
      continue;
    }

    if (y + imgH > pageH) {
      doc.addPage();
      y = 0;
    }
    doc.addImage(imgData, 'PNG', 0, y, imgW, imgH);
    y += imgH;
  }

  doc.save(filename);
  return doc.output('blob');
}

// Devuelve el PDF generado (además de descargarlo) para que quien llama
// pueda además subirlo a Supabase Storage -- ver ActasApi.upload en
// lib/services.ts, usado desde MeetingsCalendar justo después de esto.
export async function generateMeetingActaPdf(project: Project, meeting: Meeting): Promise<Blob> {
  const blocks = buildActaBlocks(project, meeting);
  return renderBlocksToPdf(blocks, `acta_${project.code}_${meeting.date}.pdf`);
}
