-- audit_log.project_id nunca tuvo FK a projects -- PostgREST no puede
-- resolver el embed project:projects(name) que usa AuditApi.all() (Línea de
-- tiempo/Calendario), así que esa consulta siempre fallaba con "Could not
-- find a relationship" y dejaba esas vistas calladamente vacías.
--
-- Antes de agregar la FK: hay filas históricas apuntando a proyectos ya
-- borrados (p. ej. el reemplazo masivo de proyectos de esta sesión) -- eso
-- es legítimo (el propio frontend ya las trata como "Proyecto eliminado"
-- cuando no hay projectName), así que se limpian a null en vez de
-- preservarlas como un id colgando de la nada.
update public.audit_log
set project_id = null
where project_id is not null
  and not exists (select 1 from public.projects p where p.id = audit_log.project_id);

alter table public.audit_log
  add constraint audit_log_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;
