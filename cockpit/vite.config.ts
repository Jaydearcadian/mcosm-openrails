import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// OpenRails Cockpit dev server. Proxies /api to the Shared Interface service
// so the cockpit can call it without cross-origin browser requests in dev.
// Override the target when running another compatible service.
const API_TARGET = process.env.OPENRAILS_API_TARGET || "https://openrails-interface-worker.microcosm.workers.dev";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
