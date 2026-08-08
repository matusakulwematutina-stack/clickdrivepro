export type UserRole = 'client' | 'driver' | 'admin' | 'super_admin';

export type VehicleType = 'taxi' | 'moto' | 'pickup';

export type RideStatus =
  | 'requested'
  | 'offered'
  | 'accepted'
  | 'arriving'
  | 'arrived'
  | 'ongoing'
  | 'completed'
  | 'cancelled_by_client'
  | 'cancelled_by_driver'
  | 'no_driver_found';

export type PaymentMethod =
  | 'cash'
  | 'wallet'
  | 'orange_money'
  | 'airtel_money'
  | 'card';

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  rating?: number | null;
  wallet_balance?: number | null;
  created_at?: string;
};

export type Driver = {
  id: string;
  profile_id: string;
  status?: string | null;
  is_online: boolean;
  is_available: boolean;
  is_enabled?: boolean | null;
  vehicle_type: VehicleType;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  plate_number: string | null;
  license_number?: string | null;
  board_document_ref?: string | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  wallet_balance?: number | null;
  updated_at?: string;
};

export type AppSettings = {
  id: number;
  active_province_code: string;
  zone_radius_km: number;
  price_per_km_taxi: number;
  price_per_km_moto: number;
  price_per_km_pickup: number;
  base_fare_taxi: number;
  base_fare_moto: number;
  base_fare_pickup: number;
  commission_percent: number;
  commission_enabled: boolean;
  pawapay_enabled: boolean;
  min_withdrawal_fc: number;
  min_driver_balance_fc?: number;
  /** Sonnerie chez 1 chauffeur (secondes) */
  driver_ring_seconds?: number;
  /** Délai réponse client à une offre (secondes) */
  client_response_seconds?: number;
  /** Durée totale recherche chauffeur (secondes) */
  search_duration_seconds?: number;
  /** Distance max chauffeur–client pour le dispatch (km), défaut 3 */
  dispatch_radius_km?: number;
  updated_at?: string;
};

export type WalletTopup = {
  id: string;
  profile_id: string;
  driver_id?: string | null;
  amount_fc: number;
  phone?: string | null;
  provider: string;
  status: 'pending' | 'approved' | 'rejected' | 'failed';
  admin_note?: string | null;
  created_at: string;
  processed_at?: string | null;
  profiles?: {
    full_name?: string | null;
    phone?: string | null;
    role?: string | null;
  } | null;
};

export type WalletLedgerEntry = {
  id: string;
  profile_id: string;
  driver_id?: string | null;
  direction: 'in' | 'out';
  kind: string;
  amount_fc: number;
  balance_after?: number | null;
  ride_id?: string | null;
  note?: string | null;
  created_at: string;
  profiles?: {
    full_name?: string | null;
    phone?: string | null;
    role?: string | null;
  } | null;
};

export type ServiceProvince = {
  code: string;
  name: string;
  center_lat: number;
  center_lng: number;
  default_radius_km: number;
  is_active: boolean;
};

export type SosAlert = {
  id: string;
  ride_id: string | null;
  client_id?: string | null;
  driver_id?: string | null;
  reporter_id?: string | null;
  reporter_role?: 'client' | 'driver' | null;
  alert_type?: string | null;
  message: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  admin_note?: string | null;
  created_at: string;
};

export type Withdrawal = {
  id: string;
  driver_id: string;
  amount_fc: number;
  phone: string;
  provider: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'failed';
  provider_ref?: string | null;
  admin_note?: string | null;
  created_at: string;
  processed_at?: string | null;
  drivers?: {
    id: string;
    plate_number?: string | null;
    profiles?: { full_name?: string | null; phone?: string | null } | null;
  } | null;
};

export type DriverAdminRow = {
  id: string;
  profile_id: string;
  is_online: boolean;
  is_available: boolean;
  is_enabled: boolean;
  vehicle_type: VehicleType;
  plate_number: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  license_number?: string | null;
  board_document_ref?: string | null;
  lat: number | null;
  lng: number | null;
  wallet_balance: number | null;
  status?: string | null;
  profiles?: { full_name?: string | null; phone?: string | null } | null;
};

/** Arrêt intermédiaire (avant la destination finale). */
export type RideStop = {
  label: string;
  lat: number;
  lng: number;
};

export type Ride = {
  id: string;
  client_id: string;
  driver_id: string | null;
  vehicle_type: VehicleType;
  status: RideStatus;
  pickup_address: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  /** Arrêts intermédiaires (max 2) — double / triple arrêt */
  stops?: RideStop[] | null;
  /** Arrêts intermédiaires déjà validés par le chauffeur */
  stops_done?: number | null;
  for_third_party?: boolean | null;
  passenger_name?: string | null;
  passenger_phone?: string | null;
  distance_km: number | null;
  duration_min: number | null;
  estimated_price: number | null;
  final_price: number | null;
  offered_to_driver_id?: string | null;
  dispatch_expires_at?: string | null;
  client_response_expires_at?: string | null;
  search_expires_at?: string | null;
  dispatch_round?: number | null;
  payment_method: PaymentMethod;
  commission_percent?: number | null;
  commission_amount?: number | null;
  commission_waived?: boolean | null;
  commission_paid?: boolean | null;
  client_rating: number | null;
  driver_rating: number | null;
  created_at: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type RideOfferStatus =
  | 'pending'
  | 'selected'
  | 'declined'
  | 'expired'
  | 'withdrawn';

export type RideOffer = {
  id: string;
  ride_id: string;
  driver_id: string;
  offered_price_cents: number;
  accepts_client_price: boolean | null;
  eta_min: number | null;
  status: RideOfferStatus;
  created_at: string;
  note?: string | null;
};
