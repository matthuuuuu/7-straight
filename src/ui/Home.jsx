import { useState } from 'react';
import { BookOpen, ArrowRight, Wifi, Smartphone, LogIn, RotateCcw } from 'lucide-react';
import { AVATARS, GAME_NAME, TAGLINE, MAX_NAME_LENGTH } from '../config.js';
import { BrandMark, Ribbon, ThemeDots } from './bits.jsx';
import { InstallBanner } from './InstallBanner.jsx';

const MODES = [
  { target: 200, title: 'Race to 200', sub: 'The official rules' },
  { target: 100, title: 'Race to 100', sub: 'A quicker game' },
];

export function BrandHeader({ theme, setTheme, compact = false }) {
  return (
    <header className={`brand-row ${compact ? 'compact' : ''}`}>
      <BrandMark size={compact ? 44 : 60} />
      <div className="brand-text">
        <h1 className="brand-title">
          <span className="brand-seven">7</span> Straight
        </h1>
        {!compact && <p className="brand-tag">{TAGLINE}</p>}
      </div>
      <ThemeDots theme={theme} setTheme={setTheme} />
    </header>
  );
}

export function Home({
  profile, setProfile, theme, setTheme, openRules, busy, error, clearError,
  prefillCode, resumes = [], onCreateOnline, onPlayLocal, onJoin,
}) {
  const [target, setTarget] = useState(200);
  const [code, setCode] = useState(prefillCode || '');
  const [nameNudge, setNameNudge] = useState(false);
  const nameOk = profile.name.trim().length > 0;

  const needName = (fn) => () => {
    if (!nameOk) {
      setNameNudge(true);
      document.getElementById('display-name')?.focus();
      return;
    }
    fn();
  };

  return (
    <div className="page home">
      <BrandHeader theme={theme} setTheme={setTheme} />

      <button className="panel link-card" onClick={openRules}>
        <BookOpen size={24} className="link-card-icon" aria-hidden="true" />
        <span className="link-card-text">
          <b>New here? How to play</b>
          <small>The rules in two minutes</small>
        </span>
        <ArrowRight size={22} aria-hidden="true" />
      </button>

      {resumes.map((r) => (
        <button key={r.key} className="panel link-card resume" onClick={r.onClick} disabled={busy}>
          <RotateCcw size={22} className="link-card-icon" aria-hidden="true" />
          <span className="link-card-text">
            <b>{r.title}</b>
            <small>{r.sub}</small>
          </span>
          <ArrowRight size={22} aria-hidden="true" />
        </button>
      ))}

      {error && (
        <div className="panel notice bad" role="alert">
          <span>{error}</span>
          <button className="text-btn" onClick={clearError}>Dismiss</button>
        </div>
      )}

      <section className="panel">
        <Ribbon>You at the table</Ribbon>
        <input
          id="display-name"
          className={`field ${nameNudge && !nameOk ? 'nudge' : ''}`}
          placeholder="Display name"
          autoComplete="nickname"
          maxLength={MAX_NAME_LENGTH}
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          aria-label="Display name"
        />
        {nameNudge && !nameOk && <p className="field-hint">Pick a name so everyone knows who’s who.</p>}
        <div className="avatar-picker" role="radiogroup" aria-label="Pick your picture">
          {AVATARS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={profile.avatar === a}
              className={`avatar-choice ${profile.avatar === a ? 'on' : ''}`}
              onClick={() => setProfile({ ...profile, avatar: a })}
            >
              <span aria-hidden="true">{a}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <Ribbon>Start a game</Ribbon>
        <div className="tiles" role="radiogroup" aria-label="Game length">
          {MODES.map((m) => (
            <button
              key={m.target}
              role="radio"
              aria-checked={target === m.target}
              className={`tile ${target === m.target ? 'on' : ''}`}
              onClick={() => setTarget(m.target)}
            >
              <b>{m.title}</b>
              <small>{m.sub}</small>
            </button>
          ))}
        </div>
        <div className="start-buttons">
          <button className="btn btn-primary btn-block btn-tall" disabled={busy} onClick={needName(() => onCreateOnline(target))}>
            <Wifi size={20} aria-hidden="true" />
            <span className="btn-stack">
              Create online room
              <small>Everyone plays on their own phone</small>
            </span>
          </button>
          <button className="btn btn-ghost btn-block btn-tall" disabled={busy} onClick={needName(() => onPlayLocal(target))}>
            <Smartphone size={20} aria-hidden="true" />
            <span className="btn-stack">
              Play on this device
              <small>Pass and play, or play against bots</small>
            </span>
          </button>
        </div>
      </section>

      <section className="panel">
        <Ribbon>Join friends</Ribbon>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            needName(() => onJoin(code))();
          }}
        >
          <input
            className="field code-field"
            placeholder="CODE"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            aria-label="Room code"
          />
          <button className="btn btn-primary" disabled={busy || code.length !== 4}>
            <LogIn size={18} aria-hidden="true" /> Join
          </button>
        </form>
        <p className="muted small">Ask the host for the 4-letter code, or scan the QR code on their screen.</p>
      </section>

      <footer className="credits">
        <p>
          {GAME_NAME} is a fan-made, non-commercial tribute to <i>Flip 7</i> by Eric Olsen, published by The Op.
          Made for a class project; not affiliated with or endorsed by them.
        </p>
      </footer>

      <InstallBanner />
    </div>
  );
}
