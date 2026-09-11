-- El frontend ya trataba 'superadmin' como un rol válido (types/domain.ts,
-- ToolsPage.tsx, etc.) pero el enum de la base de datos nunca se actualizó.
-- ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción en la que
-- se consume el valor nuevo, así que va en su propia migración; el resto
-- (is_admin/is_staff, promover la primera cuenta) va en la siguiente.

alter type public.user_role add value if not exists 'superadmin';
