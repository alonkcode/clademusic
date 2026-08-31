import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";


// https://vitejs.dev/config/
// GitHub Pages serves the app from /clademusic/; Vercel serves it from the
// root. VITE_BASE_PATH overrides both when a host needs something else.
const basePath =
  process.env.VITE_BASE_PATH ?? (process.env.VERCEL ? "/" : "/clademusic/");

export default defineConfig(({ mode }) => ({
  base: basePath,
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
