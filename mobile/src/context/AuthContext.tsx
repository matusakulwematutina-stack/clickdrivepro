import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { phoneAuthEmails, phoneToAuthEmail, normalizePhone } from '../lib/phone';
import { supabase } from '../lib/supabase';
import type { Driver, Profile, UserRole, VehicleType } from '../types';

type ExistingPhoneProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  driver: Driver | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  lookupPhone: (phone: string) => Promise<ExistingPhoneProfile | null>;
  signInWithPhone: (phone: string, password: string) => Promise<string | null>;
  signUpWithPhone: (params: {
    phone: string;
    password: string;
    fullName: string;
    role: UserRole;
    vehicleType?: VehicleType;
    plateNumber?: string;
  }) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function linkProfileByPhone() {
  const { data, error } = await supabase.rpc('link_existing_profile_by_phone');
  if (error) {
    console.warn('link_existing_profile_by_phone:', error.message);
    return null;
  }
  return data as { profile_id: string; reused: boolean; previous_id: string | null } | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile((p as Profile) ?? null);

    if (p?.role === 'driver') {
      const { data: d } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle();
      setDriver((d as Driver) ?? null);
    } else {
      setDriver(null);
    }
  };

  const refreshProfile = async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  };

  useEffect(() => {
    let mounted = true;
    const bootTimeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 8000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        if (data.session?.user?.id) {
          return loadProfile(data.session.user.id).finally(() => {
            if (mounted) setLoading(false);
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user?.id) {
        loadProfile(next.user.id);
      } else {
        setProfile(null);
        setDriver(null);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(bootTimeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      driver,
      loading,
      refreshProfile,
      lookupPhone: async (phone) => {
        const normalized = normalizePhone(phone);
        const { data, error } = await supabase.rpc('lookup_profile_by_phone', {
          p_phone: normalized,
        });
        if (error) {
          console.warn('lookup_profile_by_phone:', error.message);
          return null;
        }
        const row = Array.isArray(data) ? data[0] : data;
        return (row as ExistingPhoneProfile) ?? null;
      },
      signInWithPhone: async (phone, password) => {
        if (!password || password.length < 6) {
          return 'Mot de passe trop court (6 caractères minimum, lettres et/ou chiffres).';
        }
        const normalized = normalizePhone(phone);
        const emails = phoneAuthEmails(normalized);

        let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'] | null =
          null;
        let lastError: string | null = null;

        for (const email of emails) {
          const res = await supabase.auth.signInWithPassword({ email, password });
          if (!res.error && res.data.user) {
            data = res.data;
            lastError = null;
            break;
          }
          lastError = res.error?.message ?? lastError;
        }

        if (!data?.user) {
          const msg = (lastError || '').toLowerCase();
          if (msg.includes('invalid') || msg.includes('credentials')) {
            return 'Téléphone ou mot de passe incorrect. Utilisez le mot de passe déjà défini pour ce numéro (compte existant).';
          }
          if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
            return 'Compte non confirmé. Réessaie ou contacte le support.';
          }
          return lastError || 'Connexion impossible.';
        }

        await linkProfileByPhone();
        await loadProfile(data.user.id);
        return null;
      },
      signUpWithPhone: async ({
        phone,
        password,
        fullName,
        role,
        vehicleType,
        plateNumber,
      }) => {
        if (!password || password.length < 6) {
          return 'Mot de passe trop court (6 caractères minimum, lettres et/ou chiffres).';
        }
        const normalized = normalizePhone(phone);
        const email = phoneToAuthEmail(normalized);

        // Réutilise le rôle / nom déjà en base si le téléphone existe
        const { data: existingRows } = await supabase.rpc('lookup_profile_by_phone', {
          p_phone: normalized,
        });
        const existing = (Array.isArray(existingRows) ? existingRows[0] : existingRows) as
          | ExistingPhoneProfile
          | undefined;
        const finalRole = (existing?.role as UserRole) || role;
        const finalName = fullName.trim() || existing?.full_name || 'Utilisateur';

        let userId: string | undefined;

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: finalName,
              role: finalRole,
              phone: normalized,
              vehicle_type: vehicleType ?? 'taxi',
              plate_number: plateNumber ?? 'N/A',
            },
          },
        });

        if (error) {
          // Compte auth déjà créé pour ce téléphone → connexion + liaison
          if (/already|registered|exists/i.test(error.message)) {
            const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            if (loginErr) {
              return 'Ce numéro a déjà un mot de passe. Utilisez Connexion, ou un autre mot de passe si vous venez de vous tromper.';
            }
            userId = loginData.user?.id;
          } else {
            return error.message;
          }
        } else {
          userId = data.user?.id;
          // Si Supabase n'a pas ouvert de session (confirm email), on se connecte tout de suite
          if (!data.session) {
            const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            if (loginErr) {
              return 'Compte créé mais connexion bloquée. Vérifie que la confirmation e-mail est désactivée dans Supabase, puis réessaie Connexion.';
            }
            userId = loginData.user?.id ?? userId;
          }
        }

        if (!userId) return 'Impossible de créer la session.';

        const linked = await linkProfileByPhone();

        // Profil neuf (pas encore en base)
        if (!linked?.reused) {
          await supabase.from('profiles').upsert({
            id: userId,
            full_name: finalName,
            phone: normalized,
            role: finalRole,
          });
        }

        if (finalRole === 'driver') {
          const { data: drv } = await supabase
            .from('drivers')
            .select('id')
            .eq('profile_id', userId)
            .maybeSingle();

          let driverId = drv?.id as string | undefined;
          if (!driverId) {
            const { data: created, error: dErr } = await supabase
              .from('drivers')
              .insert({
                profile_id: userId,
                status: 'offline',
                is_online: false,
                is_available: true,
                vehicle_type: vehicleType ?? 'taxi',
                plate_number: plateNumber ?? 'N/A',
              })
              .select('id')
              .single();
            if (dErr) return dErr.message;
            driverId = created.id;

            await supabase.from('vehicles').insert({
              driver_id: driverId,
              vehicle_type: vehicleType ?? 'taxi',
              model: 'N/A',
              color: 'N/A',
              plate: plateNumber ?? 'N/A',
              status: 'active',
            });
          }
        }

        await loadProfile(userId);
        return null;
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
        setDriver(null);
      },
    }),
    [session, profile, driver, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
