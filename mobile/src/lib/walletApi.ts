import { supabase } from './supabase';
import type { WalletLedgerEntry, WalletTopup } from '../types';

export async function requestTopup(amountFc: number, phone?: string | null) {
  const amount = Number(amountFc);
  if (!amount || amount < 100) {
    throw new Error('Montant minimum : 100 FC');
  }
  const tel = String(phone || '').trim();
  if (tel.replace(/\D/g, '').length < 8) {
    throw new Error('Indiquez un numéro de paiement valide');
  }
  const { data, error } = await supabase.rpc('request_wallet_topup', {
    p_amount: amount,
    p_phone: tel,
    p_provider: 'pawapay',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchMyTopups(): Promise<WalletTopup[]> {
  const { data, error } = await supabase
    .from('wallet_topups')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data as WalletTopup[]) ?? [];
}

export async function fetchMyLedger(): Promise<WalletLedgerEntry[]> {
  const { data, error } = await supabase
    .from('wallet_ledger')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return (data as WalletLedgerEntry[]) ?? [];
}

export async function fetchAdminTopups(): Promise<WalletTopup[]> {
  const { data, error } = await supabase
    .from('wallet_topups')
    // FK explicite via colonne profile_id (évite conflit avec processed_by)
    .select('*, profiles!profile_id(full_name, phone, role)')
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data as unknown as WalletTopup[]) ?? [];
}

export async function fetchAdminLedger(): Promise<WalletLedgerEntry[]> {
  const { data, error } = await supabase
    .from('wallet_ledger')
    // FK explicite via colonne profile_id (évite conflit avec created_by)
    .select('*, profiles!profile_id(full_name, phone, role)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data as unknown as WalletLedgerEntry[]) ?? [];
}

export async function adminApproveTopup(id: string, note?: string) {
  const { error } = await supabase.rpc('admin_approve_topup', {
    p_topup_id: id,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function adminRejectTopup(id: string, note?: string) {
  const { error } = await supabase.rpc('admin_reject_topup', {
    p_topup_id: id,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function adminWalletAdjust(input: {
  profileId: string;
  direction: 'in' | 'out';
  amountFc: number;
  note?: string;
  driverId?: string | null;
}) {
  const { error } = await supabase.rpc('admin_wallet_adjust', {
    p_profile_id: input.profileId,
    p_direction: input.direction,
    p_amount: input.amountFc,
    p_note: input.note ?? null,
    p_driver_id: input.driverId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function adminWaiveRideCommission(rideId: string) {
  const { error } = await supabase.rpc('admin_waive_ride_commission', {
    p_ride_id: rideId,
  });
  if (error) throw new Error(error.message);
}

export async function finalizeRidePayments(rideId: string) {
  const { data, error } = await supabase.rpc('finalize_ride_payments', {
    p_ride_id: rideId,
  });
  if (error) throw new Error(error.message);
  return data as {
    commission: number;
    paid_commission: boolean;
    paid_client: boolean;
  };
}

export async function adminMarkWithdrawalPaid(id: string, note?: string) {
  const { error } = await supabase.rpc('admin_mark_withdrawal_paid', {
    p_withdrawal_id: id,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function fetchRecentRidesAdmin(limit = 40) {
  const { data, error } = await supabase
    .from('rides')
    .select(
      'id, status, estimated_price, final_price, commission_amount, commission_waived, commission_paid, pickup_address, dropoff_address, created_at, vehicle_type',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateDriverVehicle(driverId: string, patch: {
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  plate_number?: string | null;
  license_number?: string | null;
  board_document_ref?: string | null;
  vehicle_type?: string;
}) {
  const { error } = await supabase
    .from('drivers')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', driverId);
  if (error) throw new Error(error.message);
}
