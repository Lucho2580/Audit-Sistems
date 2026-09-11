-- Backfill de una sola vez: los jefes que ya se habían agregado ANTES del
-- fix en add_project_jefe() (2026091112) se quedaron sin fila de
-- participante en las reuniones previas de su proyecto -- se corrige para
-- el estado actual sin tener que quitarlos y volverlos a agregar.
insert into public.participants (meeting_id, label, email)
select m.id, pj.jefe_nombre, pr.email
from public.project_jefes pj
join public.meetings m on m.project_id = pj.project_id
join public.profiles pr on pr.id = pj.jefe_id
where not exists (
  select 1 from public.participants pt where pt.meeting_id = m.id and pt.label = pj.jefe_nombre
);
