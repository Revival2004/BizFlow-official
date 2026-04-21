import React, { createContext, useContext, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../utils/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

const AuthContext = createContext({});

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

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(*)')
        .eq('id', userId)
        .single();
      if (!error) setProfile(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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
    return { data, error };
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

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signIn, signOut, hasPermission, isAdmin, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
