-- Una identidad de Microsoft solo se puede adjuntar al usuario con su MISMO
-- correo.
--
-- linkIdentity() (banner "Vincular mi cuenta Microsoft") adjunta la cuenta de
-- Microsoft con la que se complete el login, sea cual sea -- y si el
-- navegador ya tenía abierta la de otra persona, Microsoft la usa sin
-- preguntar. Sin este chequeo, alguien con sesión de soporte.ti (superadmin)
-- y Microsoft abierto como a.sistemas terminaría con la identidad de
-- a.sistemas pegada a la cuenta superadmin: desde ahí a.sistemas entra con
-- Microsoft como superadmin. El frontend ya fuerza prompt=select_account,
-- pero eso solo evita el error por descuido; esto lo hace imposible.
--
-- En un alta nueva (primer login de un invitado) auth.users y la identidad
-- tienen el mismo correo, así que pasa sin problema.

create or replace function public.enforce_azure_identity_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_email text;
begin
  if new.provider <> 'azure' then
    return new;
  end if;
  select email into v_user_email from auth.users where id = new.user_id;
  if lower(coalesce(new.identity_data->>'email', '')) <> lower(coalesce(v_user_email, '')) then
    raise exception 'La cuenta de Microsoft (%) no coincide con el correo de este usuario (%).',
      new.identity_data->>'email', v_user_email;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_azure_identity_email on auth.identities;
create trigger enforce_azure_identity_email
  before insert or update on auth.identities
  for each row execute function public.enforce_azure_identity_email();
