import { Linking, Platform } from 'react-native';
import type { LatLng } from '../types';

/**
 * Ouvre l’app Google Maps (navigation GPS) vers une destination.
 * Si l’app n’est pas installée → version web.
 */
export async function openGoogleMapsNavigation(
  destination: LatLng,
  label?: string,
) {
  const { latitude, longitude } = destination;
  const name = encodeURIComponent(label || 'Destination');

  const androidNav = `google.navigation:q=${latitude},${longitude}`;
  const androidMaps = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${name})`;
  const iosMaps = `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;

  try {
    if (Platform.OS === 'android') {
      const canNav = await Linking.canOpenURL(androidNav);
      if (canNav) {
        await Linking.openURL(androidNav);
        return;
      }
      await Linking.openURL(androidMaps);
      return;
    }

    const canIos = await Linking.canOpenURL(iosMaps);
    if (canIos) {
      await Linking.openURL(iosMaps);
      return;
    }
  } catch {
    /* fallback web */
  }

  await Linking.openURL(web);
}
