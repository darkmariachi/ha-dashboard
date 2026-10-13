import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Prefix '' loads every key, including the non-VITE_ Spotify ones — they're
  // only used by the dev proxy below, never exposed to client code.
  const env = loadEnv(mode, process.cwd(), '')
  const spotifyAuth =
    env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET
      ? Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')
      : ''

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      // Dev twin of the /api/spotify-token location in nginx.conf.
      proxy: {
        '/api/spotify-token': {
          target: 'https://accounts.spotify.com',
          changeOrigin: true,
          rewrite: () => '/api/token',
          headers: spotifyAuth ? { Authorization: `Basic ${spotifyAuth}` } : {},
        },
        // Dev twin of nginx's /api/push/ location, for a push service run
        // locally (`node push/server.mjs`) — QR sign-in relays through it.
        '/api/push': {
          target: env.PUSH_DEV_URL || 'http://localhost:8082',
          rewrite: (path) => path.replace(/^\/api\/push/, ''),
        },
      },
    },
  }
})
