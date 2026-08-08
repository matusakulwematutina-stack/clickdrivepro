import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Ride, RideStatus } from '../types';

const STORAGE_KEY = '@clickdrive/active_ride_id';

/** Statuts où la course doit reprendre après déconnexion / redémarrage */
export const ACTIVE_CLIENT_STATUSES: RideStatus[] = [
  'requested',
  'offered',
  'accepted',
  'arriving',
  'arrived',
  'ongoing',
];

export const ACTIVE_DRIVER_STATUSES: RideStatus[] = [
  'accepted',
  'arriving',
  'arrived',
  'ongoing',
];

export async function rememberActiveRide(rideId: string) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, rideId);
  } catch {
    /* ignore */
  }
}

export async function clearActiveRide() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function getRememberedRideId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function fetchActiveRideForClient(clientId: string): Promise<Ride | null> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('client_id', clientId)
    .in('status', ACTIVE_CLIENT_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('fetchActiveRideForClient:', error.message);
    return null;
  }
  const ride = (data as Ride) ?? null;
  if (ride) await rememberActiveRide(ride.id);
  else await clearActiveRide();
  return ride;
}

export async function fetchActiveRideForDriver(driverId: string): Promise<Ride | null> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', driverId)
    .in('status', ACTIVE_DRIVER_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('fetchActiveRideForDriver:', error.message);
    return null;
  }
  const ride = (data as Ride) ?? null;
  if (ride) await rememberActiveRide(ride.id);
  else await clearActiveRide();
  return ride;
}

/** Recharge une course mémorisée si elle est encore active */
export async function fetchRememberedActiveRide(
  statuses: RideStatus[],
): Promise<Ride | null> {
  const id = await getRememberedRideId();
  if (!id) return null;

  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('id', id)
    .in('status', statuses)
    .maybeSingle();

  if (error || !data) {
    await clearActiveRide();
    return null;
  }
  return data as Ride;
}
