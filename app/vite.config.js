import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'

// The client shows the installed package version so it can be compared against the
// version the server process is actually running. Reading package.json here and
// injecting it keeps the frontend free of imports that reach outside src/.
const pkg = createRequire(import.meta.url)('./package.json')

// Excalidraw (the whiteboard editor) loads its hand-drawn and CJK fonts from
// `<EXCALIDRAW_ASSET_PATH>/fonts/...`, falling back to the esm.sh CDN. They are
// served from ClaudeWeb itself instead, so whiteboards work offline and where
// the CDN is unreachable: from node_modules while developing, copied into
// dist/excalidraw-assets on build. src/modules/artefacts/whiteboard/assetPath.ts
// points Excalidraw at them.
const EXCALIDRAW_FONTS = fileURLToPath(new URL('./node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url))

function excalidrawAssets() {
  let outDir = 'dist'
  return {
    name: 'claudeweb-excalidraw-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      const prefix = `${(server.config.base || '/').replace(/\/?$/, '/')}excalidraw-assets/fonts/`
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(prefix)) return next()
        const relative = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
        const file = path.resolve(EXCALIDRAW_FONTS, relative)
        if (!file.startsWith(EXCALIDRAW_FONTS + path.sep) || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (!fs.existsSync(EXCALIDRAW_FONTS)) return
      fs.cpSync(EXCALIDRAW_FONTS, path.join(outDir, 'excalidraw-assets', 'fonts'), { recursive: true })
    }
  }
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001

  return {
    // The UI can be served under a sub-path such as /claude/.
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), excalidrawAssets()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5173,
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        // noVNC is a prebuilt public ES module; keep it out of Vite's import transforms.
        '/novnc': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/browser-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/claude-desktop-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/plugin-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
