import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext({});

export const lightColors = {
  primary: '#1A1F36',
  secondary: '#2563EB',
  accent: '#00D2A0',
  danger: '#EF4444',
  warning: '#F59F00',
  success: '#22C55E',
  bg: '#F1F5F9',
  card: '#FFFFFF',
  text: '#0F172A',
  textLight: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
  tabBar: '#FFFFFF',
  header: '#1A1F36',
  headerText: '#FFFFFF',
  inputBg: '#F8FAFC',
  currency: 'KES',
};

export const darkColors = {
  primary: '#0F172A',
  secondary: '#3B82F6',
  accent: '#00D2A0',
  danger: '#EF4444',
  warning: '#F59F00',
  success: '#22C55E',
  bg: '#0F172A',
  card: '#1E293B',
  text: '#F1F5F9',
  textLight: '#94A3B8',
  border: '#334155',
  white: '#FFFFFF',
  tabBar: '#1E293B',
  header: '#1E293B',
  headerText: '#F1F5F9',
  inputBg: '#0F172A',
  currency: 'KES',
};

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('theme').then(v => {
      if (v === 'dark') setIsDark(true);
    });
  }, []);

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDark(next);
    await AsyncStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const colors = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
