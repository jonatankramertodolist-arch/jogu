import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any host, including a subfolder.
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // Exposes the dev server on the local network so a phone can open it.
    host: true,
    // Pinned rather than left to drift upwards when the port is busy. All saved
    // data lives in the browser and is tied to the exact address, so a moving
    // port makes the athlete's plan look like it disappeared.
    port: 5173,
    strictPort: true,
  },
});
