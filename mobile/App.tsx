import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import {
  fetchActiveRideForClient,
  fetchActiveRideForDriver,
} from './src/lib/activeRide';
import { loadServiceConfig } from './src/lib/serviceConfig';
import { colors } from './src/lib/theme';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { ClientHomeScreen } from './src/screens/client/ClientHomeScreen';
import { RideTrackingScreen } from './src/screens/client/RideTrackingScreen';
import { DriverHomeScreen } from './src/screens/driver/DriverHomeScreen';
import { DriverRideScreen } from './src/screens/driver/DriverRideScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { AdminHomeScreen } from './src/screens/admin/AdminHomeScreen';
import { DriverVehicleScreen } from './src/screens/driver/DriverVehicleScreen';
import type { Ride } from './src/types';

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  ClientHome: undefined;
  RideTracking: { rideId: string };
  DriverHome: undefined;
  DriverRide: { ride: Ride };
  DriverVehicle: undefined;
  History: undefined;
  AdminHome: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bgPanel,
    primary: colors.yellow,
    text: colors.white,
    border: colors.border,
  },
};

function BootScreen() {
  return (
    <View style={styles.boot}>
      <ActivityIndicator size="large" color={colors.yellow} />
      <Text style={styles.brand}>ClickPro Drive</Text>
      <Text style={styles.bootHint}>Reprise de session…</Text>
    </View>
  );
}

function ActiveRideNavigator() {
  const { session, profile, driver, loading } = useAuth();
  /** undefined = chargement de la course active */
  const [resumeRide, setResumeRide] = useState<Ride | null | undefined>(undefined);
  const [navEpoch, setNavEpoch] = useState(0);

  // Réglages admin (zone, tarifs, commission) — boot + retour premier plan
  useEffect(() => {
    if (!session?.user?.id) return;
    void loadServiceConfig(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadServiceConfig(true);
    });
    return () => sub.remove();
  }, [session?.user?.id]);

  useEffect(() => {
    if (loading) return;

    if (!session?.user?.id || !profile) {
      setResumeRide(null);
      return;
    }

    if (profile.role === 'admin' || profile.role === 'super_admin') {
      setResumeRide(null);
      return;
    }

    let cancelled = false;

    const load = async (fromForeground = false) => {
      try {
        let ride: Ride | null = null;
        if (profile.role === 'driver') {
          if (!driver?.id) {
            if (!cancelled) setResumeRide(null);
            return;
          }
          ride = await fetchActiveRideForDriver(driver.id);
        } else {
          ride = await fetchActiveRideForClient(session.user.id);
        }
        if (cancelled) return;

        setResumeRide((prev) => {
          // Si on revient au premier plan et qu'une course active existe
          // alors qu'on n'en avait pas, forcer la reprise.
          if (fromForeground && ride && !prev) {
            setNavEpoch((k) => k + 1);
          }
          return ride;
        });
      } catch {
        if (!cancelled) setResumeRide(null);
      }
    };

    load(false);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load(true);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [loading, session?.user?.id, profile?.id, profile?.role, driver?.id]);

  if (loading) return <BootScreen />;
  if (session && profile && resumeRide === undefined) return <BootScreen />;

  const initialRoute =
    !session || !profile
      ? 'Welcome'
      : profile.role === 'admin' || profile.role === 'super_admin'
        ? 'AdminHome'
        : profile.role === 'driver'
          ? resumeRide
            ? 'DriverRide'
            : 'DriverHome'
          : resumeRide
            ? 'RideTracking'
            : 'ClientHome';

  return (
    <Stack.Navigator
      key={`nav-${profile?.id ?? 'out'}-${navEpoch}-${initialRoute}`}
      initialRouteName={initialRoute as keyof RootStackParamList}
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      {!session || !profile ? (
        <>
          <Stack.Screen name="Welcome">
            {({ navigation }) => (
              <WelcomeScreen
                onLogin={() => navigation.navigate('Login')}
                onRegister={() => navigation.navigate('Register')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Login">
            {({ navigation }) => (
              <AuthScreen
                mode="login"
                onBack={() => navigation.navigate('Welcome')}
                onSwitch={() => navigation.navigate('Register')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Register">
            {({ navigation }) => (
              <AuthScreen
                mode="register"
                onBack={() => navigation.navigate('Welcome')}
                onSwitch={() => navigation.navigate('Login')}
              />
            )}
          </Stack.Screen>
        </>
      ) : profile.role === 'admin' || profile.role === 'super_admin' ? (
        <Stack.Screen name="AdminHome" component={AdminHomeScreen} />
      ) : profile.role === 'driver' ? (
        <>
          <Stack.Screen name="DriverHome">
            {({ navigation }) => (
              <DriverHomeScreen
                onOpenRide={(ride) => navigation.navigate('DriverRide', { ride })}
                onResumeRide={(ride) => navigation.navigate('DriverRide', { ride })}
                onOpenVehicle={() => navigation.navigate('DriverVehicle')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen
            name="DriverRide"
            initialParams={resumeRide ? { ride: resumeRide } : undefined}
          >
            {({ route, navigation }) => (
              <DriverRideScreen
                ride={route.params.ride}
                onDone={() => navigation.navigate('DriverHome')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="DriverVehicle">
            {({ navigation }) => (
              <DriverVehicleScreen onBack={() => navigation.goBack()} />
            )}
          </Stack.Screen>
          <Stack.Screen name="History">
            {({ navigation }) => <HistoryScreen onBack={() => navigation.goBack()} />}
          </Stack.Screen>
        </>
      ) : (
        <>
          <Stack.Screen name="ClientHome">
            {({ navigation }) => (
              <ClientHomeScreen
                onRideCreated={(ride) =>
                  navigation.navigate('RideTracking', { rideId: ride.id })
                }
                onResumeRide={(ride) =>
                  navigation.navigate('RideTracking', { rideId: ride.id })
                }
                onOpenHistory={() => navigation.navigate('History')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen
            name="RideTracking"
            initialParams={resumeRide ? { rideId: resumeRide.id } : undefined}
          >
            {({ route, navigation }) => (
              <RideTrackingScreen
                rideId={route.params.rideId}
                onClose={() => navigation.navigate('ClientHome')}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="History">
            {({ navigation }) => <HistoryScreen onBack={() => navigation.goBack()} />}
          </Stack.Screen>
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="light" />
          <ActiveRideNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  brand: {
    color: colors.yellow,
    fontWeight: '900',
    fontSize: 22,
  },
  bootHint: {
    color: colors.muted,
    fontSize: 13,
  },
});
