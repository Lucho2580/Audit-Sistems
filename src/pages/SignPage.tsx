import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MeetingsApi, type SignStatus } from '../lib/services';

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [tab, setTab] = useState<'draw' | 'type'>('type');
  const [typedName, setTypedName] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [status, setStatus] = useState<SignStatus | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!token) return;
    MeetingsApi.getSignStatus(token)
      .then((s) => {
        if (!s) { setLinkError('El enlace de firma no es válido o ya expiró.'); return; }
        setStatus(s);
      })
      .catch(() => setLinkError('El enlace de firma no es válido o ya expiró.'))
      .finally(() => setCheckingStatus(false));
  }, [token]);

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const rect = canvasRef.current!.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }
  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const rect = canvasRef.current!.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#16232E';
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  }
  function endDraw() {
    drawing.current = false;
  }
  function clearCanvas() {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function confirmSignature() {
    if (!token) return;
    setError(null);
    let signature: string;
    if (tab === 'type') {
      if (!typedName.trim()) { setError('Escribe tu nombre completo para firmar.'); return; }
      signature = typedName.trim();
    } else {
      signature = canvasRef.current!.toDataURL('image/png');
    }
    try {
      await MeetingsApi.signByToken(token, signature);
      setDone(true);
      MeetingsApi.notifySignatureCompleted(token).catch(() => {
        // No es crítico: la firma ya quedó registrada de todos modos.
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg && msg.includes('ya fue firmado')) {
        setStatus((s) => (s ? { ...s, alreadySigned: true } : s));
      } else if (msg && msg.includes('caducó')) {
        setStatus((s) => (s ? { ...s, expired: true } : s));
      } else {
        setError(msg || 'El enlace de firma no es válido o ya expiró.');
      }
    }
  }

  // Contenido del acta -- para que quien firma sepa exactamente qué está
  // aprobando, no un formulario a ciegas.
  function DocumentPreview() {
    if (!status) return null;
    const rows: [string, string][] = [
      ['Temas tratados', status.topics],
      ['Acuerdos y compromisos', status.agreements],
      ['Riesgos u observaciones', status.risks],
      ['Próximos pasos', status.nextSteps],
    ];
    return (
      <div className="sign-document">
        <div className="sign-document-head">
          <span className="hu-tag">Doc</span>
          <div>
            <div className="sign-document-title">{status.meetingTitle || 'Reunión de seguimiento'}</div>
            <div className="sign-document-meta">
              {status.projectCode} · {status.projectName} · {status.meetingDate}
            </div>
          </div>
        </div>
        {rows.map(([label, value]) => (
          <div className="sign-document-field" key={label}>
            <div className="sign-document-label">{label}</div>
            <p>{value?.trim() || 'Sin registrar.'}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="appbar">
        <span className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          Sistema de auditoría <span className="dot">·</span> Firma digital de acta
        </span>
      </div>
      <div className="masthead">
        <div>
          <p className="eyebrow">Firma digital de acta</p>
          <h1>Confirmar participación</h1>
          <p className="sub">Revisa el acta y firma para confirmar tu asistencia y los acuerdos registrados.</p>
        </div>
      </div>

      <div className="section">
        <div className="sign-block">
          {checkingStatus ? (
            <p className="sign-info">Verificando enlace…</p>
          ) : done ? (
            <div className="sign-success">
              <div className="check">✓</div>
              <p>Tu firma fue registrada correctamente. Ya puedes cerrar esta ventana.</p>
            </div>
          ) : linkError ? (
            <div className="auth-error">{linkError}</div>
          ) : status?.alreadySigned ? (
            <>
              <DocumentPreview />
              <div className="sign-success">
                <div className="check">✓</div>
                <p>Este documento ya fue firmado anteriormente. No es necesario firmar de nuevo.</p>
              </div>
            </>
          ) : status?.expired ? (
            <>
              <DocumentPreview />
              <div className="auth-error">
                Este enlace de firma ya caducó (30 días desde la reunión). Pide que te reenvíen uno nuevo.
              </div>
            </>
          ) : (
            <>
              <DocumentPreview />
              <div className="sign-info">
                Al firmar, confirmas tu participación en la reunión y los acuerdos documentados arriba.
              </div>
              {error && <div className="auth-error">{error}</div>}
              <div className="sign-tabs">
                <button
                  className={`sign-tab ${tab === 'type' ? 'active' : ''}`}
                  onClick={() => setTab('type')}
                >
                  Escribir nombre
                </button>
                <button
                  className={`sign-tab ${tab === 'draw' ? 'active' : ''}`}
                  onClick={() => setTab('draw')}
                >
                  Dibujar firma
                </button>
              </div>
              {tab === 'type' ? (
                <div className="sign-typed">
                  <input
                    type="text"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder="Tu nombre completo"
                  />
                </div>
              ) : (
                <div>
                  <canvas
                    ref={canvasRef}
                    id="sigCanvas"
                    width={520}
                    height={180}
                    onPointerDown={startDraw}
                    onPointerMove={moveDraw}
                    onPointerUp={endDraw}
                    onPointerLeave={endDraw}
                  />
                  <div style={{ marginTop: 8 }}>
                    <button className="btn ghost small" onClick={clearCanvas} type="button">
                      Limpiar
                    </button>
                  </div>
                </div>
              )}
              <div className="sign-actions">
                <button className="btn" onClick={confirmSignature}>
                  Confirmar firma
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
