import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // snarkjs expects a Node-style global in the browser
  define: { global: "globalThis" },
  optimizeDeps: { esbuildOptions: { target: "es2020" } },
  build: { target: "es2020", chunkSizeWarningLimit: 3000 },
});
