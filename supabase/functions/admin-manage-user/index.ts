// Invita/edita/elimina cuentas de "Persona asignada" (desarrollador),
// "Jefe de proyecto" (admin), "Cliente" y "QA" -- vía SSO de Microsoft Entra
// ID, no correo+contraseña. Un admin ya no crea la cuenta de Auth
// directamente: registra una invitación pendiente (tabla pending_invites);
// la fila real de auth.users la crea Supabase Auth la primera vez que esa
// persona entra con su cuenta de Microsoft, y dos triggers de base de datos
// (ver migración 2026101401_entra_sso_invites.sql) aprovisionan el
// `profiles` correspondiente en ese momento. Por eso "crear" aquí no toca la
// Admin API de Auth en absoluto -- solo necesita la service_role key para
// poder insertar en pending_invites sin pasar por RLS (que no da permiso de
// escritura a authenticated/anon a propósito) y para poder borrar cuentas ya
// confirmadas.
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta
// Supabase automáticamente en cada Edge Function; no hace falta configurarlos
// a mano como secrets.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendMail } from '../_shared/graph.ts';

// URL pública de la app, para el link de login en el correo de invitación.
// Reusa el secret SITE_URL que ya existe en el proyecto (mismo que usan las
// demás funciones para armar links).
const APP_URL = Deno.env.get('SITE_URL') ?? 'https://laviandaauditsistems.netlify.app';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// El correo de invitación se manda para toda cuenta nueva -- "Cliente"
// (portal de firma de actas), "Persona asignada"/desarrollador, "Jefe de
// proyecto"/admin y QA.
async function sendInviteEmail(params: {
  email: string;
  fullName: string;
  isResend: boolean;
}): Promise<{ emailSent: boolean; emailError?: string }> {
  const subject = params.isResend
    ? 'Recordatorio: tu acceso al Sistema de Auditoría'
    : 'Tu acceso al Sistema de Auditoría';
  const html = `
    <p>Hola ${params.fullName},</p>
    <p>Se te dio acceso al Sistema de Auditoría de La Vianda.</p>
    <p>Entra con tu cuenta de Microsoft (<strong>${params.email}</strong>) -- no necesitas
       crear ni recordar ninguna contraseña nueva.</p>
    <p><a href="${APP_URL}/login">Ir al sistema</a></p>
  `;

  try {
    await sendMail({ to: params.email, subject, html });
    return { emailSent: true };
  } catch (err) {
    return { emailSent: false, emailError: (err as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    // Cliente "como quien llama", solo para confirmar que es admin.
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'No autenticado.' }, 401);
    }
    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    const callerRole = callerProfile?.role;
    if (callerRole !== 'admin' && callerRole !== 'superadmin') {
      return json({ error: 'Solo un administrador puede gestionar usuarios.' }, 403);
    }
    const isSuperadmin = callerRole === 'superadmin';

    // Cliente con privilegios de administración (bypassa RLS).
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const { action } = body ?? {};

    if (action === 'create') {
      const { fullName, role } = body;
      const email = (body.email as string | undefined)?.trim().toLowerCase();
      const allowedRoles = isSuperadmin ? ['cliente', 'desarrollador', 'admin', 'qa'] : ['cliente', 'desarrollador'];
      if (!email || !fullName || !allowedRoles.includes(role)) {
        const rolesMsg = isSuperadmin ? 'cliente, desarrollador, admin o qa' : 'cliente o desarrollador';
        return json({ error: `Faltan datos o el rol no es válido (solo ${rolesMsg}).` }, 400);
      }

      const { data: existingProfile } = await admin
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .maybeSingle();
      if (existingProfile) {
        return json({ error: 'Ya existe una cuenta confirmada con ese correo.' }, 400);
      }

      // Upsert: invitar dos veces al mismo correo actualiza nombre/rol en vez
      // de fallar -- así "editar una invitación pendiente" es la misma
      // acción que "crear".
      const { error: inviteErr } = await admin.from('pending_invites').upsert({
        email,
        full_name: fullName,
        role,
        invited_by: userData.user.id,
      });
      if (inviteErr) return json({ error: inviteErr.message }, 400);

      const { emailSent, emailError } = await sendInviteEmail({ email, fullName, isResend: false });
      return json({ email, invited: true, emailSent, emailError });
    }

    if (action === 'resend_invite') {
      const email = (body.email as string | undefined)?.trim().toLowerCase();
      if (!email) return json({ error: 'Falta el correo.' }, 400);

      const { data: invite } = await admin
        .from('pending_invites')
        .select('email, full_name')
        .eq('email', email)
        .maybeSingle();
      if (!invite) return json({ error: 'Esa invitación ya no está pendiente.' }, 404);

      const { emailSent, emailError } = await sendInviteEmail({
        email: invite.email, fullName: invite.full_name, isResend: true,
      });
      return json({ emailSent, emailError });
    }

    if (action === 'cancel_invite') {
      const email = (body.email as string | undefined)?.trim().toLowerCase();
      if (!email) return json({ error: 'Falta el correo.' }, 400);
      const { error } = await admin.from('pending_invites').delete().eq('email', email);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'update') {
      const { id, fullName } = body;
      if (!id || !fullName) return json({ error: 'Faltan datos.' }, 400);
      const { error } = await admin.from('profiles').update({ full_name: fullName }).eq('id', id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return json({ error: 'Falta el id.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: `Acción no reconocida: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? 'Error desconocido.' }, 500);
  }
});
