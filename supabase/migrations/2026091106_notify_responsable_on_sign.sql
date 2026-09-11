-- Cuando alguien firma un acta, la persona asignada del proyecto (el
-- responsable) recibe un correo avisando que esa persona ya firmó -- ver la
-- función notify-signature, invocada desde SignPage.tsx justo después de
-- sign_participant(). responsable_notified_at evita mandar el aviso más de
-- una vez para la misma fila de participante (por ejemplo si el navegador
-- reintenta la llamada tras firmar).
alter table public.participants
  add column if not exists responsable_notified_at timestamptz;
