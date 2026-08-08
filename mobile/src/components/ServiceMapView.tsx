import React, { forwardRef, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import MapView, {
  type MapViewProps,
  type Region,
  PROVIDER_GOOGLE,
} from 'react-native-maps';
import { LUBUMBASHI_REGION } from '../lib/geo';
import {
  constrainServiceMapRegion,
  getServiceMapRegion,
} from '../lib/serviceConfig';

type Props = Omit<MapViewProps, 'provider'> & {
  lockServiceArea?: boolean;
  /** Style Google Maps (trafic, bâtiments) — recommandé chauffeur */
  googleStyle?: boolean;
};

/**
 * Carte Google Maps, limitée à la zone de service admin (province + rayon).
 */
export const ServiceMapView = forwardRef<MapView, Props>(function ServiceMapView(
  {
    lockServiceArea = true,
    googleStyle = false,
    onRegionChangeComplete,
    initialRegion,
    region,
    ...rest
  },
  ref,
) {
  const localRef = useRef<MapView | null>(null);

  const setRef = useCallback(
    (node: MapView | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<MapView | null>).current = node;
    },
    [ref],
  );

  const handleRegion = useCallback(
    (r: Region) => {
      if (lockServiceArea) {
        const fixed = constrainServiceMapRegion(r);
        if (fixed) {
          localRef.current?.animateToRegion(fixed, 220);
        }
      }
      onRegionChangeComplete?.(r);
    },
    [lockServiceArea, onRegionChangeComplete],
  );

  return (
    <MapView
      ref={setRef}
      provider={PROVIDER_GOOGLE}
      mapType="standard"
      initialRegion={initialRegion ?? region ?? getServiceMapRegion() ?? LUBUMBASHI_REGION}
      onRegionChangeComplete={handleRegion}
      minZoomLevel={8}
      maxZoomLevel={20}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass
      showsScale={Platform.OS === 'android'}
      showsBuildings={googleStyle}
      showsTraffic={googleStyle}
      showsIndoors={false}
      rotateEnabled
      pitchEnabled={googleStyle}
      toolbarEnabled={false}
      {...rest}
    />
  );
});
