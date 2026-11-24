import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// Relative base so the site works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // The generator (the sender) and Receive (the partner meter).
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        receive: resolve(import.meta.dirname, 'receive.html'),
      },
    },
  },
})
