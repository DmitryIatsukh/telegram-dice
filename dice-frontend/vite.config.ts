import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// your current frontend ngrok hostname:
const allowedNgrokDomain = 'uncapitulating-persuadingly-elsie.ngrok-free.dev'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: [allowedNgrokDomain],
    proxy: {
      // anything starting with /api will be sent to backend
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
})
