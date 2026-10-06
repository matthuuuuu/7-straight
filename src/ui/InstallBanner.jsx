import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { GAME_NAME } from '../config.js';
import { BrandMark } from './bits.jsx';
import { load, save } from '../net/storage.js';

const HIDE_FOR_MS = 14 * 864e5; // after "x", don't ask again for two weeks

// Chrome/Edge/Android fire this before they'd show their own install prompt;
// we keep it so the banner's button can trigger it. Listen as early as
// possible, since it can fire before React renders.
let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function InstallBanner() {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => Date.now() - load('installHiddenAt', 0) < HIDE_FOR_MS);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  if (hidden || isStandalone()) return null;
  const canPrompt = !!deferredPrompt;
  const ios = isIOS();
  if (!canPrompt && !ios) return null;

  const dismiss = () => {
    save('installHiddenAt', Date.now());
    setHidden(true);
  };

  const install = async () => {
    if (canPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      dismiss();
    } else {
      setShowIosHelp((v) => !v);
    }
  };

  return (
    <div className="install-banner" role="region" aria-label={`Install ${GAME_NAME}`}>
      <BrandMark size={48} />
      <div className="install-text">
        <b>Install {GAME_NAME}</b>
        {showIosHelp ? (
          <small>
            Tap <Share size={14} aria-label="Share" className="inline-icon" /> then <b>Add to Home Screen</b>.
          </small>
        ) : (
          <small>One tap, right from your home screen.</small>
        )}
      </div>
      <button className="btn btn-primary btn-sm" onClick={install}>
        <Download size={16} aria-hidden="true" /> Install
      </button>
      <button className="icon-btn" onClick={dismiss} aria-label="Not now">
        <X size={20} />
      </button>
    </div>
  );
}
