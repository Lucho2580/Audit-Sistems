-- El proveedor de un proyecto vuelve a ser editable.
--
-- Contexto: "Editar actores" dejó de mostrar el proveedor bajo el supuesto
-- de que MyOffice era el único, y al guardar mandaba proveedor_id =
-- (el del proyecto) ?? MyOffice. Pero 63 de 65 proyectos tienen el
-- proveedor solo como texto (Ingetet, Colombiacode, Visitrack...) con
-- proveedor_id null -- así que guardar cualquier cambio de jefe/asignado
-- les reescribía el proveedor a "MyOffice". Le pasó a DEV-103 (Visitrack).

-- 1) set_project_actors ya no toca el proveedor cuando no se le pasa uno
--    (p_proveedor_id null): el proveedor se cambia aparte, con
--    set_project_provider(). Misma firma, para no romper a quien la llama.
create or replace function public.set_project_actors(p_project_id uuid, p_responsable_id uuid, p_proveedor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before      jsonb;
  v_after       jsonb;
  v_resp_nombre text;
  v_prov_nombre text;
begin
  if not public.is_admin() then
    raise exception 'No autorizado para asignar los actores de este proyecto.';
  end if;

  select jsonb_build_object(
    'responsable_id', responsable_id, 'proveedor_id', proveedor_id
  ) into v_before
  from public.projects where id = p_project_id;

  if v_before is null then
    raise exception 'Proyecto no encontrado.';
  end if;

  select coalesce(full_name, email) into v_resp_nombre from public.profiles where id = p_responsable_id;

  if p_proveedor_id is null then
    update public.projects
       set responsable_id = p_responsable_id, responsable_nombre = v_resp_nombre
     where id = p_project_id;
    v_after := jsonb_build_object('responsable_id', p_responsable_id, 'proveedor_id', v_before->'proveedor_id');
  else
    select name into v_prov_nombre from public.providers where id = p_proveedor_id;
    update public.projects
       set responsable_id = p_responsable_id, responsable_nombre = v_resp_nombre,
           proveedor_id = p_proveedor_id, proveedor = v_prov_nombre
     where id = p_project_id;
    v_after := jsonb_build_object('responsable_id', p_responsable_id, 'proveedor_id', p_proveedor_id);
  end if;

  if v_before is distinct from v_after then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update', v_before, v_after,
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

-- 2) Asignar el proveedor por nombre. Vacío = "Sin asignar". Un nombre que
--    no existe en providers se agrega (sin distinguir mayúsculas), así queda
--    como sugerencia para los demás proyectos.
create or replace function public.set_project_provider(p_project_id uuid, p_proveedor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text := nullif(btrim(coalesce(p_proveedor, '')), '');
  v_prov_id uuid;
  v_before  jsonb;
begin
  if not public.is_admin() then
    raise exception 'No autorizado para cambiar el proveedor de este proyecto.';
  end if;

  select jsonb_build_object('proveedor', proveedor, 'proveedor_id', proveedor_id) into v_before
  from public.projects where id = p_project_id;
  if v_before is null then
    raise exception 'Proyecto no encontrado.';
  end if;

  if v_name is not null and lower(v_name) <> 'sin asignar' then
    select id, name into v_prov_id, v_name from public.providers where lower(name) = lower(v_name) limit 1;
    if v_prov_id is null then
      v_name := nullif(btrim(coalesce(p_proveedor, '')), '');
      insert into public.providers (name) values (v_name) returning id into v_prov_id;
    end if;
  else
    v_name := 'Sin asignar';
  end if;

  update public.projects set proveedor = v_name, proveedor_id = v_prov_id where id = p_project_id;

  if v_before is distinct from jsonb_build_object('proveedor', v_name, 'proveedor_id', v_prov_id) then
    insert into public.audit_log (entity_type, entity_id, action, before, after, actor_email, project_id)
    values ('project', p_project_id, 'update', v_before,
            jsonb_build_object('proveedor', v_name, 'proveedor_id', v_prov_id),
            (select email from public.profiles where id = auth.uid()), p_project_id);
  end if;
end;
$$;

revoke all on function public.set_project_provider(uuid, text) from public, anon;
grant execute on function public.set_project_provider(uuid, text) to authenticated;

-- 3) Devolver a DEV-103 el proveedor que el error le reescribió (solo si
--    sigue en MyOffice, por si alguien ya lo corrigió a mano).
update public.projects
   set proveedor = 'Visitrack', proveedor_id = null
 where code = 'DEV-103' and proveedor = 'MyOffice';
