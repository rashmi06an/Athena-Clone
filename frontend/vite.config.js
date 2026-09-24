import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /api/* requests to the Express backend at port 3000
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Strip the /api prefix before forwarding to backend
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
