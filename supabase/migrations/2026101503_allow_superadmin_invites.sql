-- Permite registrar una invitación pendiente con rol superadmin.
--
-- Con SSO ya no hay forma de crear la cuenta de un superadmin "a mano" con
-- contraseña: la fila de auth.users la crea Supabase Auth en su primer login
-- con Microsoft, y para eso el trigger reject_unauthorized_signup exige una
-- invitación pendiente.
--
-- A propósito esto NO se abre en admin-manage-user ni en /tools (allí un
-- superadmin solo puede invitar cliente/desarrollador/admin/qa): un
-- superadmin nuevo se invita únicamente con SQL directo en la base, p. ej.
--   insert into public.pending_invites (email, full_name, role)
--   values ('correo@lavianda.co', 'Nombre Apellido', 'superadmin');

alter table public.pending_invites drop constraint if exists pending_invites_role_check;
alter table public.pending_invites
  add constraint pending_invites_role_check
  check (role in ('admin', 'desarrollador', 'cliente', 'qa', 'superadmin'));
