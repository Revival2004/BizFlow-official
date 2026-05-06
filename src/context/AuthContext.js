import React, { createContext, useContext, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../utils/supabase';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { cacheProfile, clearCachedProfile, getCachedProfile } from '../utils/offline';
import { getBusinessBillingState, getPlanEntitlements } from '../utils/billing';

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

  const loadProfile = async (userId, { persist = true } = {}) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(*), businesses(id, name, display_name, status, billing_status, subscription_started_at, subscription_expires_at, current_plan_id, current_plan:billing_plans!businesses_current_plan_id_fkey(id, slug, name, is_lifetime, is_trial, billing_days))')
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
            message: 'Your BizFlow account is not ready yet. Finish onboarding or ask your business admin for an invite.',
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
      await cacheProfile(userId, data);

      return { data, error: null };
    } catch (e) {
      console.error(e);
      const cachedProfile = await getCachedProfile(userId);
      if (cachedProfile) {
        if (persist) {
          setProfile(cachedProfile);
        }

        return {
          data: cachedProfile,
          error: {
            message: 'Using your last synced account data while offline.',
            isOfflineCache: true,
          },
        };
      }

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
    const signedInUserId = user?.id || session?.user?.id;
    await supabase.auth.signOut();
    await clearCachedProfile(signedInUserId);
    setProfile(null);
  };

  const hasPermission = (permission) => {
    if (!profile) return false;
    const perms = profile.roles?.permissions || {};
    return perms[permission] === true;
  };

  const isAdmin = () => profile?.roles?.name === 'admin';
  const billingState = getBusinessBillingState(profile?.businesses);
  const isBillingBlocked = billingState.isBlocked;
  const planEntitlements = getPlanEntitlements(profile?.businesses);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signIn, signOut, hasPermission, isAdmin, fetchProfile, billingState, isBillingBlocked, planEntitlements }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
