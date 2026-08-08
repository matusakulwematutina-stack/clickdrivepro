import React, { useEffect, useRef, useState } from 'react';
import { VehicleMarker } from './VehicleMarker';
import {
  lerpLatLng,
  pointAtProgress,
  snapToRoute,
} from '../lib/routeFollow';
import type { LatLng, VehicleType } from '../types';

type Props = {
  route: LatLng[];
  gps?: LatLng | null;
  headingHint?: number | null;
  vehicleType?: VehicleType | null;
  vehicleColor?: string | null;
  title?: string;
  /** Sans GPS : avance seul sur le guidage (aperçu fluide) */
  autoCruise?: boolean;
  cruiseDurationMs?: number;
};

/**
 * Véhicule premium collé au guidage routier — mouvement fluide + cap de la route.
 */
export function GuidedVehicleMarker({
  route,
  gps,
  headingHint,
  vehicleType,
  vehicleColor,
  title,
  autoCruise = false,
  cruiseDurationMs = 16000,
}: Props) {
  const [display, setDisplay] = useState<LatLng | null>(
    route.length ? route[0] : null,
  );
  const [heading, setHeading] = useState(0);

  const displayRef = useRef<LatLng | null>(route.length ? route[0] : null);
  const targetRef = useRef<LatLng | null>(null);
  const bearingRef = useRef(0);
  const cruiseStart = useRef<number | null>(null);

  useEffect(() => {
    if (route.length < 2) return;

    if (gps) {
      const snap = snapToRoute(gps, route);
      if (snap) {
        targetRef.current = snap.point;
        bearingRef.current = snap.bearing;
        cruiseStart.current = null;
        if (!displayRef.current) {
          displayRef.current = snap.point;
          setDisplay(snap.point);
          setHeading(snap.bearing);
        }
      }
      return;
    }

    if (autoCruise && cruiseStart.current == null) {
      cruiseStart.current = Date.now();
    }
  }, [gps?.latitude, gps?.longitude, route, autoCruise]);

  useEffect(() => {
    if (route.length < 2) return;

    const id = setInterval(() => {
      if (!gps && autoCruise) {
        const start = cruiseStart.current ?? Date.now();
        cruiseStart.current = start;
        const t = ((Date.now() - start) % cruiseDurationMs) / cruiseDurationMs;
        const along = pointAtProgress(route, t);
        if (along) {
          targetRef.current = along.point;
          bearingRef.current = along.bearing;
        }
      }

      const target = targetRef.current;
      if (!target) return;

      const cur = displayRef.current ?? target;
      const next = lerpLatLng(cur, target, 0.22);
      displayRef.current = next;
      setDisplay(next);

      const desired =
        typeof headingHint === 'number' && headingHint >= 0
          ? headingHint * 0.2 + bearingRef.current * 0.8
          : bearingRef.current;

      setHeading((prev) => {
        let diff = desired - prev;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        return (prev + diff * 0.25 + 360) % 360;
      });
    }, 48);

    return () => clearInterval(id);
  }, [route, gps, autoCruise, cruiseDurationMs, headingHint]);

  if (!display) return null;

  return (
    <VehicleMarker
      key={`gveh-${vehicleType}-${vehicleColor || 'x'}`}
      coordinate={display}
      heading={heading}
      vehicleType={vehicleType}
      vehicleColor={vehicleColor}
      title={title}
    />
  );
}
