import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Palette, X } from 'lucide-react';

/** The app icon: a fan of cards behind a big yellow 7. */
export function BrandMark({ size = 56 }) {
  const fan = ['#14a3a4', '#e5604f', '#72a3d8', '#fcde51', '#e3425f', '#fef8da', '#d4d42a'];
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="1" y="1" width="62" height="62" rx="16" fill="#7fcdd3" stroke="#2d388f" strokeWidth="2" />
      <g transform="translate(32 43)">
        {fan.map((c, i) => (
          <rect key={c} x="-6" y="-30" width="12" height="20" rx="2.5" fill={c} stroke="#2d388f" strokeWidth="1.6"
            transform={`rotate(${-66 + i * 22})`} />
        ))}
      </g>
      <path d="M19 27h27v6.2L35.2 55h-8.4l10.4-21.8H19z" fill="#fcde51" stroke="#2d388f" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M21.6 29.4h21.6" stroke="#e5604f" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Rulebook-style navy banner with a notched end. */
export function Ribbon({ children, as: Tag = 'h2', className = '' }) {
  return <Tag className={`ribbon ${className}`}>{children}</Tag>;
}

export function Avatar({ emoji, size = 40, away = false, bot = false }) {
  return (
    <span className={`avatar ${away ? 'away' : ''}`} style={{ '--s': `${size}px` }}>
      <span className="avatar-emoji" aria-hidden="true">{emoji}</span>
      {bot && <span className="avatar-badge" title="Computer player">🤖</span>}
    </span>
  );
}

/** Bottom sheet on phones, centered dialog on bigger screens. */
export function Sheet({ open, onClose, title, children, className = '', wide = false, labelledBy }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  // Focus the dialog once when it opens (not on every update), and hand focus
  // back to whatever opened it when it closes.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose ? (e) => e.target === e.currentTarget && closeRef.current?.() : undefined}>
      <div
        className={`sheet ${wide ? 'wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={ref}
      >
        {onClose && (
          <button className="icon-btn sheet-close" onClick={() => closeRef.current?.()} aria-label="Close">
            <X size={20} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export const THEMES = [
  { id: 'cream', label: 'Cream', swatch: '#fef8da', ring: '#2d388f' },
  { id: 'aqua', label: 'Aqua', swatch: '#7fcdd3', ring: '#2d388f' },
  { id: 'night', label: 'Night', swatch: '#1b2260', ring: '#fcde51' },
];

export function ThemeDots({ theme, setTheme }) {
  return (
    <div className="theme-dots" role="radiogroup" aria-label="Color theme">
      <Palette size={18} className="theme-dots-icon" aria-hidden="true" />
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          aria-label={`${t.label} theme`}
          className={`theme-dot ${theme === t.id ? 'on' : ''}`}
          style={{ '--swatch': t.swatch, '--dot-ring': t.ring }}
          onClick={() => setTheme(t.id)}
        />
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" className="toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function QRCode({ text, size = 168 }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`-2 -2 ${cells.n + 4} ${cells.n + 4}`} role="img" aria-label="QR code for the invite link">
      <rect x="-2" y="-2" width={cells.n + 4} height={cells.n + 4} fill="#fffdf3" rx="1.5" />
      <path d={cells.d} fill="#2d388f" shapeRendering="crispEdges" />
    </svg>
  );
}

const CONFETTI_COLORS = ['#fcde51', '#e5604f', '#72a3d8', '#14a3a4', '#e3425f', '#d4d42a', '#fef8da'];

export function Confetti({ pieces = 90 }) {
  const bits = useMemo(
    () => Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      dur: 2.4 + Math.random() * 1.8,
      rot: Math.random() * 360,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      w: 6 + Math.random() * 6,
      drift: (Math.random() - 0.5) * 120,
    })),
    [pieces],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          style={{
            left: `${b.left}%`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
            background: b.color,
            width: b.w,
            height: b.w * 0.45,
            '--rot': `${b.rot}deg`,
            '--drift': `${b.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

/** A little queue of messages that fade away on their own. */
export function useToasts(max = 3, ttl = 2800) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback(
    (t) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-(max - 1)), { ...t, id }]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), ttl);
    },
    [max, ttl],
  );
  return [toasts, push];
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, []);
  return [copied, copy];
}
