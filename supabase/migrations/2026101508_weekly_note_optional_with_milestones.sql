-- Con el reporte por hitos (2026101507) el comentario general es opcional
-- cuando se reportaron hitos (cada hito no cumplido ya trae su propio
-- comentario). La regla vieja exigía nota siempre y rechazaba ese envío.
-- Ahora: nota obligatoria solo si el reporte no tiene hitos -- eso lo valida
-- submit_weekly_report; aquí basta con que no sea null.

alter table public.project_weekly_progress drop constraint if exists project_weekly_progress_note_check;
alter table public.project_weekly_progress
  add constraint project_weekly_progress_note_check check (note is not null);
