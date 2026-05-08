import { Platform, Share } from 'react-native';
import * as ExpoLinking from 'expo-linking';

export const isWebPlatform = Platform.OS === 'web';

export const openExternalUrl = async (url) => {
  if (!url) {
    throw new Error('No URL provided.');
  }

  if (isWebPlatform && typeof window !== 'undefined') {
    const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.assign(url);
    }
    return { method: 'window-opened' };
  }

  await ExpoLinking.openURL(url);
  return { method: 'linking-opened' };
};

export const copyText = async (value) => {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error('Nothing to copy.');
  }

  if (isWebPlatform && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return { method: 'clipboard' };
  }

  throw new Error('Clipboard copy is not available on this device.');
};

export const shareText = async ({ title, message, url }) => {
  const payload = {
    title: title || 'BizFlow',
    text: message || '',
    url: url || '',
  };

  if (isWebPlatform && typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share(payload);
    return { method: 'navigator-share' };
  }

  if (isWebPlatform) {
    const fallbackText = [payload.title, payload.text, payload.url].filter(Boolean).join('\n\n');
    await copyText(fallbackText);
    return { method: 'clipboard' };
  }

  await Share.share({
    title: payload.title,
    message: [payload.text, payload.url].filter(Boolean).join('\n\n'),
    url: payload.url || undefined,
  });
  return { method: 'native-share' };
};
