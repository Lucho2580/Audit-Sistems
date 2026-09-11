-- is_superadmin() (2026091002) nunca se llegó a usar: el gate real de
-- "solo superadmin puede crear cuentas admin" quedó implementado en TS
-- directo dentro de admin-manage-user/index.ts (callerRole === 'superadmin'),
-- no vía este RPC. Confirmado sin referencias en políticas RLS, otras
-- funciones, el frontend ni las Edge Functions -- código muerto.

drop function if exists public.is_superadmin();
