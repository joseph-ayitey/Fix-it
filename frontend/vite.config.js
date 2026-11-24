import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the UI calls relative /api/* URLs and Vite proxies them to the backend
// (cd ../backend && npm start). That keeps the browser on a single origin, so the
// backend needs no CORS configuration at all.
const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Leaflet (the map) and React change far less often than our own code: in their own
        // files, the browser keeps them cached across our releases, and the main bundle stays small.
        manualChunks(id) {
          if (id.includes("node_modules/leaflet")) return "leaflet";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.jsx"],
    // These tests click and type through whole pages. On a busy machine (or a slow CI
    // server) that can take seconds, so allow up to 20 s per test instead of 5.
    testTimeout: 20_000,
    css: false,
  },
});
