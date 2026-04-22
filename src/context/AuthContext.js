import React, { createContext, useContext, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../utils/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

const AuthContext = createContext({});
const SUPER_ADMIN_EMAIL = 'revivalthuranira@gmail.com';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) await fetchProfile(session.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId, { persist = true } = {}) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(*), businesses(id, name, status)')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        await supabase.auth.signOut();
        if (persist) {
          setProfile(null);
        }

        return {
          data: null,
          error: {
            message: 'Your account is not approved yet. You need a valid admin token or staff invitation.',
          },
        };
      }

      if (data.status !== 'active') {
        await supabase.auth.signOut();
        if (persist) {
          setProfile(null);
        }

        return {
          data: null,
          error: {
            message: 'Your account is not active. Contact your business admin.',
          },
        };
      }

      if (data.businesses?.status && data.businesses.status !== 'active') {
        await supabase.auth.signOut();
        if (persist) {
          setProfile(null);
        }

        return {
          data: null,
          error: {
            message: 'This business has been suspended. Contact BizFlow support.',
          },
        };
      }

      if (persist) {
        setProfile(data);
      }

      return { data, error: null };
    } catch (e) {
      console.error(e);
      if (persist) {
        setProfile(null);
      }
      return {
        data: null,
        error: {
          message: e.message || 'Could not load your account.',
        },
      };
    } finally {
      if (persist) {
        setLoading(false);
      }
    }
  };

  const fetchProfile = async (userId) => loadProfile(userId, { persist: true });

  useRealtimeRefresh({
    enabled: Boolean(user?.id),
    channelName: `auth-profile:${user?.id}`,
    bindings: [
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user?.id}`,
      },
      ...(profile?.role_id
        ? [{
            event: '*',
            schema: 'public',
            table: 'roles',
          filter: `id=eq.${profile.role_id}`,
        }]
        : []),
      ...(profile?.business_id
        ? [{
            event: '*',
            schema: 'public',
            table: 'businesses',
            filter: `id=eq.${profile.business_id}`,
          }]
        : []),
    ],
    onChange: () => {
      if (user?.id) {
        fetchProfile(user.id);
      }
    },
  });

  const signIn = async (email, password) => {
    if (!isSupabaseConfigured) {
      return {
        data: null,
        error: {
          message: 'Add your Supabase URL and anon key before signing in.',
        },
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { data, error };
    }

    const signedInUserId = data?.user?.id || data?.session?.user?.id;
    if (!signedInUserId) {
      return { data, error: null };
    }

    const profileResult = await loadProfile(signedInUserId, { persist: true });
    if (profileResult.error) {
      return { data: null, error: profileResult.error };
    }

    return { data, error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  const hasPermission = (permission) => {
    if (!profile) return false;
    const perms = profile.roles?.permissions || {};
    return perms[permission] === true;
  };

  const isAdmin = () => profile?.roles?.name === 'admin';
  const isSuperAdmin = () =>
    profile?.is_super_admin === true &&
    profile?.email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL;

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signIn, signOut, hasPermission, isAdmin, isSuperAdmin, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
