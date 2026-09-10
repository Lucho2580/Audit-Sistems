// URL pública de la app en producción. Se usa para armar cualquier enlace
// que se comparta o mande por correo (recuperar contraseña, firma de acta),
// en vez de window.location.origin -- así el link siempre apunta a la página
// real sin importar si quien dispara la acción está probando en localhost.
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://laviandaauditsistems.netlify.app';
