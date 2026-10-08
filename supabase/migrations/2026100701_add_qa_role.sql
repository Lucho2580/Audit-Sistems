-- Nuevo rol 'qa' (verificación/aprobación de fases). Va en su propia
-- migración porque "ALTER TYPE ... ADD VALUE" no puede usarse en la misma
-- transacción en la que después se referencia ese valor nuevo -- el resto
-- de cambios (is_staff(), RLS, RPCs) va en la siguiente migración.
alter type public.user_role add value if not exists 'qa';
