import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const isWeb = Platform.OS === 'web';

function getStandaloneStatus() {
  if (!isWeb || typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true;
}

export default function WebPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!isWeb || typeof window === 'undefined') {
      return undefined;
    }

    const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
    const updateInstallState = () => setIsInstalled(getStandaloneStatus());
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setUpdateReady(false);
      updateInstallState();
    };
    const handleOnlineStatus = () => setIsOffline(window.navigator.onLine === false);
    const handleUpdateReady = () => setUpdateReady(true);

    updateInstallState();
    handleOnlineStatus();

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    document.addEventListener('bizflow-sw-update-ready', handleUpdateReady);
    standaloneQuery?.addEventListener?.('change', updateInstallState);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
      document.removeEventListener('bizflow-sw-update-ready', handleUpdateReady);
      standaloneQuery?.removeEventListener?.('change', updateInstallState);
    };
  }, []);

  const canInstall = Boolean(deferredPrompt) && !isInstalled;
  const shouldShow = isWeb && (canInstall || isOffline || updateReady);

  const bannerTone = useMemo(() => {
    if (updateReady) {
      return { background: '#1D4ED8', border: '#3B82F6', label: 'Update ready' };
    }

    if (isOffline) {
      return { background: '#7C2D12', border: '#F59E0B', label: 'Offline mode' };
    }

    return { background: '#0F172A', border: '#2563EB', label: 'Install BizFlow' };
  }, [isOffline, updateReady]);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome !== 'accepted') {
        setDeferredPrompt(null);
        return;
      }
    } catch (error) {
      console.error('PWA install prompt error:', error);
    } finally {
      setDeferredPrompt(null);
    }
  };

  const handleRefresh = async () => {
    try {
      const registration = window.__BIZFLOW_SW_REGISTRATION__;
      if (registration?.waiting) {
        const onControllerChange = () => {
          window.location.reload();
        };

        navigator.serviceWorker?.addEventListener?.('controllerchange', onControllerChange, { once: true });
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }

      window.location.reload();
    } catch (error) {
      console.error('PWA refresh error:', error);
      window.location.reload();
    }
  };

  if (!shouldShow) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: bannerTone.background, borderColor: bannerTone.border }]}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{bannerTone.label}</Text>
          <Text style={styles.body}>
            {updateReady
              ? 'Refresh to get the latest web improvements.'
              : isOffline
                ? 'BizFlow is using your last synced data until connection returns.'
                : 'Install BizFlow on this laptop for faster launch and a cleaner desktop feel.'}
          </Text>
        </View>

        {updateReady ? (
          <TouchableOpacity activeOpacity={0.85} onPress={handleRefresh} style={styles.primaryButton}>
            <Text style={styles.primaryLabel}>Refresh</Text>
          </TouchableOpacity>
        ) : canInstall ? (
          <TouchableOpacity activeOpacity={0.85} onPress={handleInstall} style={styles.primaryButton}>
            <Text style={styles.primaryLabel}>Install</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    left: 18,
    alignItems: 'flex-end',
    zIndex: 1200,
    pointerEvents: 'box-none',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 22,
    elevation: 12,
  },
  copy: {
    marginBottom: 12,
  },
  eyebrow: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  body: {
    color: 'rgba(248,250,252,0.88)',
    fontSize: 13,
    lineHeight: 19,
  },
  primaryButton: {
    alignSelf: 'flex-end',
    minWidth: 104,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryLabel: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
});
