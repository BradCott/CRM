import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,           // listen on 0.0.0.0 so ngrok / LAN can reach it
    allowedHosts: 'all',  // allow any host header (required for ngrok tunnels)
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
