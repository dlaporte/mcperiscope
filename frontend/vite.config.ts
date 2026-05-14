import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Read the backend bearer token written by backend/auth_token.py.
// We attach it to every proxied /api request so the browser app never needs to hold it.
function readBackendToken(): string | null {
  const p = path.join(os.homedir(), '.mcperiscope', 'token')
  try {
    return fs.readFileSync(p, 'utf-8').trim() || null
  } catch {
    return null
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        // Forward streaming responses (SSE) without buffering.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = readBackendToken()
            if (token) {
              proxyReq.setHeader('Authorization', `Bearer ${token}`)
            }
          })
        },
      },
    },
  },
})
