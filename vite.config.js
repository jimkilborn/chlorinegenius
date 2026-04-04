import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Chlor.io — Pool Chlorine Tracker",
        short_name: "Chlor.io",
        description: "Smart pool chlorine dosing and tracking",
        theme_color: "#0c1525",
        background_color: "#070e1c",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: "NetworkFirst",
            options: { cacheName: "weather-cache", expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 3 } }
          },
          {
            urlPattern: /^https:\/\/api\.zippopotam\.us\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "zip-cache", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ]
});
