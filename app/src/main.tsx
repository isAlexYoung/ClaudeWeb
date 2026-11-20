import '@/shared/installBasePath'
import React from 'react'
import ReactDOM from 'react-dom/client'

import App from '@/App'
import { registerNotificationWorker, supportsWebPush } from '@/shared/utils'
import '@/index.css'
// Bundled OFL fonts for the interface (Inter) and Claude's replies (Source Serif 4);
// served from the build, so no request leaves for a font CDN.
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import '@/shared/styles/workspace-theme.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import '@/modules/i18n'

// Notifications use a scoped worker without a fetch handler or application cache.
if (supportsWebPush()) {
  void registerNotificationWorker().catch(error => console.warn('Notification worker unavailable:', error));
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Unable to mount the app: #root is missing from the document')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
