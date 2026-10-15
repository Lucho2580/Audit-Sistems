import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SITE_URL } from '../lib/site';
import type { Profile } from '../types/domain';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signInWithMicrosoft: () => Promise<{ error?: string }>;
  linkMicrosoftAccount: () => Promise<{ error?: string }>;
  hasMicrosoftIdentity: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, fullName:full_name, mustChangePassword:must_change_password')
      .eq('id', userId)
      .single();
    setProfile(error ? null : (data as Profile));
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) loadProfile(newSession.user.id);
      else setProfile(null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message };
      },
      async signUp(email, password, fullName) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        return { error: error?.message };
      },
      // Flujo principal de aquí en adelante: entra con la cuenta de
      // Microsoft del correo corporativo, sin contraseña. Redirige a
      // login.microsoftonline.com y vuelve al mismo origen desde donde se
      // inició (no SITE_URL: eso es para enlaces que se mandan por correo;
      // aquí la persona ya está en la app, sea producción o localhost, y
      // debe volver ahí mismo). Ese origen tiene que estar en Redirect URLs
      // de Supabase o Supabase lo cambia por el Site URL. AuthProvider recoge
      // la sesión sola al volver, vía el mismo onAuthStateChange de abajo.
      async signInWithMicrosoft() {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'azure',
          // Sin el scope "email", Azure no siempre manda el correo en el
          // token y Supabase rechaza el login ("Error getting user email
          // from external provider"). prompt=select_account: sin esto
          // Microsoft entra directo con la cuenta que ya tenga abierta en el
          // navegador, sin dejar elegir otra.
          options: { redirectTo: window.location.origin, scopes: 'email', queryParams: { prompt: 'select_account' } },
        });
        return { error: error?.message };
      },
      // Para una cuenta que YA existe con contraseña (de antes del cambio a
      // SSO): adjunta la identidad de Microsoft a esta MISMA sesión/usuario
      // en vez de crear una cuenta nueva -- así conserva su profiles.id y
      // todo lo que tiene asignado. Requiere "Manual linking" habilitado en
      // Authentication > Settings del proyecto de Supabase.
      async linkMicrosoftAccount() {
        const { error } = await supabase.auth.linkIdentity({
          provider: 'azure',
          options: { redirectTo: window.location.origin, scopes: 'email', queryParams: { prompt: 'select_account' } },
        });
        return { error: error?.message };
      },
      async hasMicrosoftIdentity() {
        const { data } = await supabase.auth.getUserIdentities();
        return (data?.identities ?? []).some((i) => i.provider === 'azure');
      },
      async signOut() {
        // supabase-js intenta primero revocar la sesión en el servidor -- si
        // esa llamada falla (red, sesión ya vencida, lo que sea) se queda sin
        // limpiar el token guardado en localStorage, y la persona sigue
        // "adentro" si recarga la página aunque haya hecho clic en "Salir".
        // Por eso la limpieza local (estado + storage) se hace siempre,
        // pase lo que pase con la llamada al servidor.
        try {
          await supabase.auth.signOut();
        } catch {
          // seguimos con la limpieza local de todas formas
        }
        setSession(null);
        setProfile(null);
        try {
          Object.keys(localStorage)
            .filter((k) => /^sb-.*-auth-token$/.test(k))
            .forEach((k) => localStorage.removeItem(k));
        } catch {
          // localStorage puede no estar disponible (modo privado estricto)
        }
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${SITE_URL}/reset-password`,
        });
        return { error: error?.message };
      },
      async refreshProfile() {
        if (session) await loadProfile(session.user.id);
      },
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
