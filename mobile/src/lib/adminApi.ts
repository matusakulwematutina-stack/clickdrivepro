import { supabase } from './supabase';
import type {
  AppSettings,
  DriverAdminRow,
  ServiceProvince,
  SosAlert,
  Withdrawal,
} from '../types';

export async function fetchAppSettings(): Promise<AppSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AppSettings | null;
}

export async function updateAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const { data, error } = await supabase.rpc('admin_update_settings', {
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  return data as AppSettings;
}

export async function fetchProvinces(): Promise<ServiceProvince[]> {
  const { data, error } = await supabase
    .from('service_provinces')
    .select('*')
    .order('name');
  if (error) throw new Error(error.message);
  return (data as ServiceProvince[]) ?? [];
}

export async function setProvinceActive(code: string, radiusKm?: number) {
  const patch: Record<string, unknown> = { active_province_code: code };
  if (radiusKm != null) patch.zone_radius_km = radiusKm;
  return updateAppSettings(patch as Partial<AppSettings>);
}

export async function fetchDriversAdmin(): Promise<DriverAdminRow[]> {
  const { data, error } = await supabase
    .from('drivers')
    .select(
      'id, profile_id, is_online, is_available, is_enabled, vehicle_type, plate_number, vehicle_brand, vehicle_model, vehicle_color, license_number, board_document_ref, lat, lng, wallet_balance, status, profiles(full_name, phone)',
    )
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as DriverAdminRow[]) ?? [];
}

export async function setDriverEnabled(driverId: string, enabled: boolean) {
  const { error } = await supabase.rpc('admin_set_driver_enabled', {
    p_driver_id: driverId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

export async function resetDriverPassword(profileId: string, newPassword: string) {
  const { error } = await supabase.rpc('admin_reset_driver_password', {
    p_profile_id: profileId,
    p_new_password: newPassword,
  });
  if (error) throw new Error(error.message);
}

export async function fetchSosAlerts(): Promise<SosAlert[]> {
  const { data, error } = await supabase
    .from('sos_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data as SosAlert[]) ?? [];
}

export async function updateSosStatus(
  id: string,
  status: string,
  adminNote?: string,
) {
  const patch: Record<string, unknown> = {
    status,
    admin_note: adminNote ?? null,
    updated_at: new Date().toISOString(),
  };
  if (status === 'acknowledged') {
    patch.acknowledged_at = new Date().toISOString();
  }
  if (status === 'closed' || status === 'resolved') {
    patch.resolved_at = new Date().toISOString();
    patch.status = 'resolved';
  }
  const { error } = await supabase.from('sos_alerts').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function createSosAlert(input: {
  rideId: string;
  reporterId: string;
  reporterRole: 'client' | 'driver';
  message?: string;
  lat?: number;
  lng?: number;
  driverId?: string | null;
  clientId?: string | null;
}) {
  const payload: Record<string, unknown> = {
    ride_id: input.rideId,
    alert_type: 'emergency',
    message: input.message ?? 'SOS pendant la course',
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    status: 'open',
    reporter_id: input.reporterId,
    reporter_role: input.reporterRole,
    client_id: input.clientId ?? (input.reporterRole === 'client' ? input.reporterId : null),
    driver_id: input.driverId ?? null,
  };
  const { error } = await supabase.from('sos_alerts').insert(payload);
  if (error) throw new Error(error.message);
}

export async function fetchWithdrawals(): Promise<Withdrawal[]> {
  const { data, error } = await supabase
    .from('withdrawals')
    .select(
      '*, drivers(id, plate_number, profiles(full_name, phone))',
    )
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data as unknown as Withdrawal[]) ?? [];
}

export async function updateWithdrawalStatus(
  id: string,
  status: Withdrawal['status'],
  note?: string,
) {
  const { error } = await supabase
    .from('withdrawals')
    .update({
      status,
      admin_note: note ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Demande de retrait chauffeur → file admin PawaPay */
export async function requestWithdrawal(input: {
  driverId: string;
  amountFc: number;
  phone: string;
}) {
  const settings = await fetchAppSettings();
  if (settings && !settings.pawapay_enabled) {
    throw new Error('Les retraits PawaPay sont temporairement désactivés.');
  }
  const min = Number(settings?.min_withdrawal_fc ?? 5000);
  if (!input.amountFc || input.amountFc < min) {
    throw new Error(`Montant minimum : ${min} FC`);
  }
  const { error } = await supabase.from('withdrawals').insert({
    driver_id: input.driverId,
    amount_fc: input.amountFc,
    phone: input.phone,
    provider: 'pawapay',
    status: 'pending',
  });
  if (error) throw new Error(error.message);
}

export async function fetchAdminStats() {
  const [drivers, rides, sos, withdrawals] = await Promise.all([
    supabase.from('drivers').select('id, is_online, is_enabled', { count: 'exact' }),
    supabase
      .from('rides')
      .select('id, status', { count: 'exact' })
      .in('status', ['requested', 'offered', 'accepted', 'arriving', 'arrived', 'ongoing']),
    supabase.from('sos_alerts').select('id', { count: 'exact' }).eq('status', 'open'),
    supabase
      .from('withdrawals')
      .select('id', { count: 'exact' })
      .eq('status', 'pending'),
  ]);
  const list = (drivers.data as Array<{ is_online: boolean; is_enabled: boolean }>) ?? [];
  return {
    driversTotal: drivers.count ?? list.length,
    driversOnline: list.filter((d) => d.is_online && d.is_enabled).length,
    activeRides: rides.count ?? 0,
    openSos: sos.count ?? 0,
    pendingWithdrawals: withdrawals.count ?? 0,
  };
}
