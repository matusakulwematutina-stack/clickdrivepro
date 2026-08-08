require('dotenv').config();

/** @type {import('expo/config').ExpoConfig} */
const config = require('./app.json').expo;

module.exports = {
  expo: {
    ...config,
    ios: {
      ...config.ios,
      config: {
        ...(config.ios?.config || {}),
        // Clé Google Maps iOS (Maps SDK for iOS)
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      },
    },
    android: {
      ...config.android,
      config: {
        ...(config.android?.config || {}),
        googleMaps: {
          // Clé Google Maps Android (Maps SDK for Android)
          apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
        },
      },
    },
    plugins: [...(config.plugins || [])],
  },
};
