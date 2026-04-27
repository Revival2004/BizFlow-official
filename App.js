import 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';

function Root() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
    </>
  );
}

function StartupSplash({ onFinish }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const lineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 850,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 850,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(lineOpacity, {
          toValue: 1,
          duration: 620,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(opacity, {
        toValue: 0.28,
        duration: 520,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(lineOpacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.04,
          duration: 700,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        onFinish();
      }
    });

    return () => {
      opacity.stopAnimation();
      scale.stopAnimation();
      lineOpacity.stopAnimation();
    };
  }, [lineOpacity, onFinish, opacity, scale]);

  return (
    <Animated.View style={[styles.splashOverlay, { opacity }]}>
      <Animated.View
        style={[
          {
            transform: [{ scale }],
          },
        ]}
      >
        <Text style={styles.splashWord}>
          <Text style={styles.splashWordAccent}>B</Text>
          <Text style={styles.splashWordMain}>Flow</Text>
        </Text>
        <Animated.View style={[styles.splashLine, { opacity: lineOpacity }]} />
      </Animated.View>
    </Animated.View>
  );
}

function AppShell() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <View style={styles.appShell}>
      <Root />
      {showSplash ? <StartupSplash onFinish={() => setShowSplash(false)} /> : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#040B18',
  },
  splashWord: {
    fontSize: 54,
    fontWeight: '900',
    letterSpacing: 1.5,
    textShadowColor: 'rgba(59, 130, 246, 0.18)',
    textShadowOffset: { width: 0, height: 8 },
    textShadowRadius: 18,
  },
  splashWordAccent: {
    color: '#3B82F6',
  },
  splashWordMain: {
    color: '#F8FAFC',
  },
  splashLine: {
    alignSelf: 'center',
    width: 168,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#60A5FA',
    marginTop: 16,
  },
});
