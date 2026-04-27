import 'react-native-gesture-handler';
import React, { useState } from 'react';
import { View, ActivityIndicator, Platform, Modal, Text, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import DashboardScreen from '../screens/admin/DashboardScreen';
import NewSaleScreen from '../screens/sales/NewSaleScreen';
import SalesHistoryScreen from '../screens/sales/SalesHistoryScreen';
import StockScreen from '../screens/stock/StockScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import StaffScreen from '../screens/staff/StaffScreen';
import ProfileScreen from '../screens/admin/ProfileScreen';
import SuperAdminScreen from '../screens/admin/SuperAdminScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
const SalesStack = createStackNavigator();

const prefix = Linking.createURL('/');
const linking = {
  prefixes: [prefix, 'bizflow://'],
  config: {
    screens: {
      Auth: { screens: { Register: { path: 'register', parse: { token: t => t } }, Login: 'login' } }
    }
  }
};

function HeaderUtilityButton({ colors, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        width: 38,
        height: 38,
        borderRadius: 12,
        marginRight: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
      }}
    >
      <Ionicons name="grid-outline" size={20} color={colors.headerText} />
    </TouchableOpacity>
  );
}

function SalesStackScreen({ colors, onOpenUtilityMenu, showUtilityButton }) {
  return (
    <SalesStack.Navigator screenOptions={{
      headerStyle: { backgroundColor: colors.header },
      headerTintColor: colors.headerText,
      headerTitleStyle: { fontWeight: '700' },
      headerRight: showUtilityButton
        ? () => <HeaderUtilityButton colors={colors} onPress={onOpenUtilityMenu} />
        : undefined,
    }}>
      <SalesStack.Screen name="SalesHistory" component={SalesHistoryScreen} options={{ title: 'Sales' }} />
      <SalesStack.Screen name="NewSale" component={NewSaleScreen} options={{ title: 'New Sale' }} />
    </SalesStack.Navigator>
  );
}

function MainTabs({ navigation: rootNavigation }) {
  const { hasPermission, isSuperAdmin } = useAuth();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  const tabBarBottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 8);
  const tabBarHeight = (Platform.OS === 'android' ? 62 : 58) + tabBarBottomPadding;
  const utilityItems = [
    hasPermission('manage_staff') ? {
      route: 'Staff',
      label: 'Staff Control',
      description: 'Invite and manage your team',
      icon: 'people-outline',
    } : null,
    {
      route: 'Profile',
      label: 'Settings',
      description: 'Profile, password and payment setup',
      icon: 'settings-outline',
    },
    isSuperAdmin() ? {
      route: 'Control',
      label: 'Platform Control',
      description: 'Client tokens and business access',
      icon: 'shield-checkmark-outline',
    } : null,
  ].filter(Boolean);
  const showUtilityButton = utilityItems.length > 0;

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color }) => {
            const icons = {
              Dashboard: focused ? 'pie-chart' : 'pie-chart-outline',
              Sales: focused ? 'cart' : 'cart-outline',
              Stock: focused ? 'archive' : 'archive-outline',
              Reports: focused ? 'stats-chart' : 'stats-chart-outline',
            };
            return <Ionicons name={icons[route.name] || 'ellipse'} size={22} color={color} />;
          },
          tabBarActiveTintColor: colors.secondary,
          tabBarInactiveTintColor: colors.textLight,
          tabBarStyle: {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: tabBarHeight,
            paddingBottom: tabBarBottomPadding,
            paddingTop: 8,
            elevation: 0,
            shadowOpacity: 0,
          },
          tabBarItemStyle: {
            paddingVertical: 2,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
          tabBarHideOnKeyboard: true,
          headerStyle: { backgroundColor: colors.header, elevation: 0, shadowOpacity: 0 },
          headerTintColor: colors.headerText,
          headerTitleStyle: { fontWeight: '700', fontSize: 18 },
          headerRight: showUtilityButton
            ? () => <HeaderUtilityButton colors={colors} onPress={() => setUtilityMenuOpen(true)} />
            : undefined,
          sceneStyle: { backgroundColor: colors.bg },
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ headerTitle: 'BFlow', title: 'Home' }} />
        {hasPermission('view_sales') && (
          <Tab.Screen name="Sales" options={{ headerShown: false, title: 'Sales' }}>
            {() => (
              <SalesStackScreen
                colors={colors}
                onOpenUtilityMenu={() => setUtilityMenuOpen(true)}
                showUtilityButton={showUtilityButton}
              />
            )}
          </Tab.Screen>
        )}
        {hasPermission('view_stock') && <Tab.Screen name="Stock" component={StockScreen} options={{ title: 'Stock' }} />}
        {hasPermission('view_reports') && <Tab.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />}
      </Tab.Navigator>

      <Modal
        visible={utilityMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setUtilityMenuOpen(false)}
      >
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setUtilityMenuOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)' }}
          />

          <View style={{ paddingTop: insets.top + 58, paddingHorizontal: 16, alignItems: 'flex-end' }}>
            <View
              style={{
                width: 252,
                backgroundColor: colors.card,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: colors.border,
                overflow: 'hidden',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: isDark ? 0.35 : 0.14,
                shadowRadius: 18,
                elevation: 12,
              }}
            >
              <View style={{ padding: 14, paddingBottom: 12, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>Quick Access</Text>
                <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>
                  Secondary admin tools moved out of the bottom tabs.
                </Text>
              </View>

              {utilityItems.map((item, index) => (
                <TouchableOpacity
                  key={item.route}
                  activeOpacity={0.8}
                  onPress={() => {
                    setUtilityMenuOpen(false);
                    rootNavigation.navigate(item.route);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: index === utilityItems.length - 1 ? 0 : 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.secondary + '16',
                      marginRight: 12,
                    }}
                  >
                    <Ionicons name={item.icon} size={19} color={colors.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{item.label}</Text>
                    <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 3 }}>{item.description}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function AppStack() {
  const { hasPermission, isSuperAdmin } = useAuth();
  const { colors } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.header, elevation: 0, shadowOpacity: 0 },
        headerTintColor: colors.headerText,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        cardStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      {hasPermission('manage_staff') && (
        <Stack.Screen name="Staff" component={StaffScreen} options={{ title: 'Staff Control' }} />
      )}
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Settings' }} />
      {isSuperAdmin() && (
        <Stack.Screen name="Control" component={SuperAdminScreen} options={{ title: 'Platform Control' }} />
      )}
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} id="Auth">
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { user, profile, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator size="large" color={colors.secondary} />
    </View>
  );

  return (
    <NavigationContainer linking={linking}>
      {user && profile ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
