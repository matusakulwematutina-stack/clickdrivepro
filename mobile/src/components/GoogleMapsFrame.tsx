import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { WebView, type ShouldStartLoadRequest } from 'react-native-webview';
import type { LatLng } from '../types';

type Props = {
  active: boolean;
  destination: LatLng;
};

/** Empêche les liens qui ouvrent l’app Google Maps externe */
function allowInsideWebView(url: string): boolean {
  const u = url.toLowerCase();
  if (
    u.startsWith('intent:') ||
    u.startsWith('market:') ||
    u.startsWith('google.navigation:') ||
    u.startsWith('comgooglemaps:') ||
    u.includes('intent://') ||
    u.includes('play.google.com/store') ||
    u.includes('maps.apple.com')
  ) {
    return false;
  }
  return true;
}

/**
 * Google Maps dans le cadre de l’app — sans popup « Ouvrir l’appli ».
 */
export function GoogleMapsFrame({ active, destination }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [lockedUri, setLockedUri] = useState<string | null>(null);
  const fadedIn = useRef(false);
  const webRef = useRef<WebView>(null);

  // Mode embed = reste dans la page, pas d’interstitiel “ouvrir l’appli”
  const uri = useMemo(() => {
    const lat = destination.latitude;
    const lng = destination.longitude;
    return (
      `https://maps.google.com/maps?` +
      `daddr=${lat},${lng}` +
      `&saddr=Current+Location` +
      `&dirflg=d` +
      `&hl=fr` +
      `&output=embed` +
      `&z=15`
    );
  }, [destination.latitude, destination.longitude]);

  useEffect(() => {
    if (active && !lockedUri) {
      fadedIn.current = false;
      opacity.setValue(0);
      setLockedUri(uri);
    }
    if (!active && lockedUri) {
      fadedIn.current = false;
      opacity.setValue(0);
      setLockedUri(null);
    }
  }, [active, uri, lockedUri, opacity]);

  const onShouldStartLoadWithRequest = (req: ShouldStartLoadRequest) => {
    return allowInsideWebView(req.url);
  };

  if (!active || !lockedUri) {
    return null;
  }

  return (
    <View style={styles.fill}>
      <View style={styles.placeholder} />
      <Animated.View style={[styles.fill, { opacity }]}>
        <WebView
          ref={webRef}
          source={{ uri: lockedUri }}
          style={styles.fill}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          mediaPlaybackRequiresUserAction={false}
          startInLoadingState={false}
          cacheEnabled
          // User-Agent “mobile web” mais on bloque les intents app
          userAgent={
            Platform.OS === 'android'
              ? 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
              : undefined
          }
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onLoadEnd={() => {
            // Ferme automatiquement la popup « Ouvrir l’application »
            webRef.current?.injectJavaScript(`
              (function() {
                try {
                  var links = Array.from(document.querySelectorAll('a,button,[role="button"],span,div'));
                  for (var i = 0; i < links.length; i++) {
                    var t = (links[i].innerText || links[i].textContent || '').trim().toLowerCase();
                    if (
                      t.indexOf('rester sur le site') !== -1 ||
                      t.indexOf('stay on the web') !== -1 ||
                      t.indexOf('continuer sur le web') !== -1 ||
                      t.indexOf('use the web') !== -1
                    ) {
                      links[i].click();
                      break;
                    }
                  }
                  var s = document.createElement('style');
                  s.innerHTML = \`
                    [aria-label*="Ouvrir"],
                    [aria-label*="Open the"],
                    .ml-promotion-container,
                    .app-bottom-sheet { display:none !important; }
                  \`;
                  document.head.appendChild(s);
                } catch (e) {}
                true;
              })();
            `);

            if (fadedIn.current) return;
            fadedIn.current = true;
            Animated.timing(opacity, {
              toValue: 1,
              duration: 350,
              useNativeDriver: true,
            }).start();
          }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#e5e3df',
  },
});
