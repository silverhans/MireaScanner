import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    // Telegram WebView sometimes keeps an old HTML entrypoint cached longer than expected.
    // If we delete old hashed assets on each build, some users get a "forever loading" webapp
    // until their cache refreshes. Keeping old assets avoids hard 404s.
    emptyOutDir: false
  }
})
