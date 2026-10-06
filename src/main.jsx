import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts from the rulebook: Roboto for text, and Overpass (the open-source
// take on the Highway Gothic headings) for titles.
import '@fontsource/overpass/700.css';
import '@fontsource/overpass/800.css';
import '@fontsource/overpass/900.css';
import '@fontsource/overpass/900-italic.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/roboto-condensed/700.css';
import '@fontsource/roboto-condensed/800.css';
import '@fontsource/roboto-condensed/400-italic.css';

import './styles/app.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support + "Install" (only in the real build, so development
// never serves stale files).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
