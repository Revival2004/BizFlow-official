import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';

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

function SalesStackScreen({ colors }) {
  return (
    <SalesStack.Navigator screenOptions={{
      headerStyle: { backgroundColor: colors.header },
      headerTintColor: colors.headerText,
      headerTitleStyle: { fontWeight: '700' },
    }}>
      <SalesStack.Screen name="SalesHistory" component={SalesHistoryScreen} options={{ title: 'Sales' }} />
      <SalesStack.Screen name="NewSale" component={NewSaleScreen} options={{ title: 'New Sale' }} />
    </SalesStack.Navigator>
  );
}

function MainTabs() {
  const { hasPermission, isSuperAdmin } = useAuth();
  const { colors, isDark } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => {
          const icons = {
            Dashboard: focused ? 'pie-chart' : 'pie-chart-outline',
            Control: focused ? 'shield-checkmark' : 'shield-checkmark-outline',
            Sales: focused ? 'cart' : 'cart-outline',
            Stock: focused ? 'archive' : 'archive-outline',
            Reports: focused ? 'stats-chart' : 'stats-chart-outline',
            Staff: focused ? 'people' : 'people-outline',
            Profile: focused ? 'person' : 'person-outline',
          };
          return <Ionicons name={icons[route.name] || 'ellipse'} size={22} color={color} />;
        },
        tabBarActiveTintColor: colors.secondary,
        tabBarInactiveTintColor: colors.textLight,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 8,
          paddingTop: 4,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.header, elevation: 0, shadowOpacity: 0 },
        headerTintColor: colors.headerText,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ headerTitle: 'BizFlow', title: 'Home' }} />
      {isSuperAdmin() && (
        <Tab.Screen
          name="Control"
          component={SuperAdminScreen}
          options={{ title: 'Control', headerTitle: 'Super Admin' }}
        />
      )}
      {hasPermission('view_sales') && (
        <Tab.Screen name="Sales" options={{ headerShown: false, title: 'Sales' }}>
          {() => <SalesStackScreen colors={colors} />}
        </Tab.Screen>
      )}
      {hasPermission('view_stock') && <Tab.Screen name="Stock" component={StockScreen} options={{ title: 'Stock' }} />}
      {hasPermission('view_reports') && <Tab.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />}
      {hasPermission('manage_staff') && <Tab.Screen name="Staff" component={StaffScreen} options={{ title: 'Staff' }} />}
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
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
      {user && profile ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
