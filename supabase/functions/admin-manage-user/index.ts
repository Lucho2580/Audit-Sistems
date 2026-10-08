// Crea/edita/elimina cuentas de "Persona asignada" (desarrollador) y
// "Proveedor" (cliente) directamente desde la UI de administración, sin pasar
// por el flujo público de signUp (que exige correo de confirmación y choca con
// el límite de envío de Supabase). Usa la Admin API de Supabase Auth, que
// necesita la service_role key -- por eso esto vive en una Edge Function y
// nunca en el cliente.
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta
// Supabase automáticamente en cada Edge Function; no hace falta configurarlos
// a mano como secrets.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendMail } from '../_shared/graph.ts';

// URL pública de la app, para el link de login en el correo de bienvenida.
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

function randomTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!$%*';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// El correo con la contraseña temporal se manda para toda cuenta que entra a
// la app -- ahora incluye a "Cliente" (portal de firma de actas), además de
// "Persona asignada"/desarrollador y "Jefe de proyecto"/admin.
async function maybeSendWelcomeEmail(params: {
  role: string;
  email: string;
  fullName: string;
  tempPassword: string;
  isReset: boolean;
}): Promise<{ emailSent: boolean; emailError?: string }> {
  if (!['desarrollador', 'admin', 'cliente', 'qa'].includes(params.role)) return { emailSent: false };

  const subject = params.isReset
    ? 'Tu contraseña fue restablecida — Sistema de Auditoría'
    : 'Tu cuenta en el Sistema de Auditoría';
  const intro = params.isReset
    ? 'Se restableció la contraseña de tu cuenta.'
    : 'Se creó una cuenta para ti en el Sistema de Auditoría.';
  const html = `
    <p>Hola ${params.fullName},</p>
    <p>${intro}</p>
    <p><strong>Correo:</strong> ${params.email}<br/>
       <strong>Contraseña temporal:</strong> ${params.tempPassword}</p>
    <p>Al iniciar sesión se te pedirá cambiarla por una nueva.</p>
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
      const { email, fullName, role } = body;
      const allowedRoles = isSuperadmin ? ['cliente', 'desarrollador', 'admin', 'qa'] : ['cliente', 'desarrollador'];
      if (!email || !fullName || !allowedRoles.includes(role)) {
        const rolesMsg = isSuperadmin ? 'cliente, desarrollador, admin o qa' : 'cliente o desarrollador';
        return json({ error: `Faltan datos o el rol no es válido (solo ${rolesMsg}).` }, 400);
      }
      const tempPassword = randomTempPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created?.user) {
        return json({ error: createErr?.message ?? 'No se pudo crear el usuario.' }, 400);
      }
      const { error: profileErr } = await admin.from('profiles').upsert({
        id: created.user.id,
        email,
        full_name: fullName,
        role,
        must_change_password: true,
      });
      if (profileErr) {
        // El usuario de auth ya se creó; si el perfil falla, se revierte para
        // no dejar una cuenta de auth huérfana sin fila en profiles.
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: profileErr.message }, 400);
      }

      const { emailSent, emailError } = await maybeSendWelcomeEmail({
        role, email, fullName, tempPassword, isReset: false,
      });
      return json({ id: created.user.id, email, tempPassword, emailSent, emailError });
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

    if (action === 'reset_password') {
      const { id } = body;
      if (!id) return json({ error: 'Falta el id.' }, 400);

      const { data: targetProfile } = await admin
        .from('profiles')
        .select('email, full_name, role')
        .eq('id', id)
        .single();
      if (!targetProfile) return json({ error: 'Cuenta no encontrada.' }, 404);

      const tempPassword = randomTempPassword();
      const { error } = await admin.auth.admin.updateUserById(id, { password: tempPassword });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);

      const { emailSent, emailError } = await maybeSendWelcomeEmail({
        role: targetProfile.role,
        email: targetProfile.email,
        fullName: targetProfile.full_name ?? targetProfile.email,
        tempPassword,
        isReset: true,
      });
      return json({ tempPassword, emailSent, emailError });
    }

    return json({ error: `Acción no reconocida: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? 'Error desconocido.' }, 500);
  }
});
