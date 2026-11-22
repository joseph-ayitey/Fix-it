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
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.jsx"],
    css: false,
  },
});
