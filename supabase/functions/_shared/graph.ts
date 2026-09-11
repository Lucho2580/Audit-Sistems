// Cliente mínimo de Microsoft Graph (OAuth2 client-credentials) para mandar
// correo desde una Edge Function. Reusa la MISMA app registrada en Entra ID
// (permiso de aplicación Mail.Send, ya concedido) que usa send-signature-links
// -- no hace falta una segunda app ni un segundo consentimiento de permisos.
//
// Secrets: ya existen en este proyecto (los mismos que usa send-signature-links,
// confirmados con `supabase secrets list`), no hace falta crear nada nuevo:
//   ENTRA_TENANT_ID     -- Directory (tenant) ID de Entra ID
//   ENTRA_CLIENT_ID     -- Application (client) ID de la app
//   ENTRA_CLIENT_SECRET -- el secreto de esa app
//   ENTRA_SENDER_UPN    -- buzón remitente (UPN/correo de la cuenta que envía)

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  // Pequeño margen (30s) antes del vencimiento real para no usar un token que
  // expire a mitad de la llamada a sendMail.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const tenantId = Deno.env.get('ENTRA_TENANT_ID');
  const clientId = Deno.env.get('ENTRA_CLIENT_ID');
  const clientSecret = Deno.env.get('ENTRA_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Faltan los secrets de Microsoft Graph (ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET).',
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo autenticar contra Microsoft Graph: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3000) * 1000,
  };
  return cachedToken.value;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const sender = Deno.env.get('ENTRA_SENDER_UPN');
  if (!sender) throw new Error('Falta el secret ENTRA_SENDER_UPN.');

  const token = await getGraphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: msg.subject,
        body: { contentType: 'HTML', content: msg.html },
        toRecipients: [{ emailAddress: { address: msg.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo enviar el correo vía Microsoft Graph: ${res.status} ${await res.text()}`);
  }
}
