import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, CircleAlert } from 'lucide-react';
import { AVATARS } from './config.js';
import { load, save, roomCreds, forgetRoom } from './net/storage.js';
import { createOnlineRoom, joinOnlineRoom } from './net/online.js';
import { newLocalRoom, resumeLocalRoom, savedLocalGameAt } from './net/local.js';
import { Home, BrandHeader } from './ui/Home.jsx';
import { Lobby } from './ui/Lobby.jsx';
import { Table } from './ui/Table.jsx';
import { Rules } from './ui/Rules.jsx';
import { useTableFeed } from './game/useTableFeed.js';

const THEME_COLORS = { cream: '#fbf3d6', aqua: '#7fcdd3', night: '#141a4d' };

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = load('theme', null);
    if (saved && THEME_COLORS[saved]) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'cream';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
    save('theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

function codeFromUrl() {
  const c = new URLSearchParams(window.location.search).get('room');
  const clean = String(c || '').toUpperCase().replace(/[^A-Z]/g, '');
  return clean.length === 4 ? clean : null;
}

function setUrlRoom(code) {
  const url = code ? `${window.location.pathname}?room=${code}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

function RoomScreen({ room, profile, theme, setTheme, onExit, openRules, rulesOpen }) {
  const snap = useSyncExternalStore(room.subscribe, room.getSnapshot);
  const feed = useTableFeed(snap);

  if (snap.status === 'gone') {
    return (
      <div className="page center-page">
        <BrandHeader theme={theme} setTheme={setTheme} compact />
        <div className="panel notice-panel">
          <CircleAlert size={28} aria-hidden="true" />
          <p>{snap.error || 'This room has closed.'}</p>
          <button className="btn btn-primary" onClick={onExit}>Back to start</button>
        </div>
      </div>
    );
  }
  if (!snap.view) {
    return (
      <div className="page center-page">
        <Loader2 className="spin" size={32} aria-label="Loading" />
      </div>
    );
  }
  // Leaving for good: online, your seat goes to autopilot; on this device,
  // the saved game is deleted.
  const leave = async () => {
    await room.send({ type: 'leave' });
    if (room.mode === 'online') forgetRoom(room.code);
    onExit();
  };
  if (snap.view.game.phase === 'lobby' || !feed.d || feed.d.phase === 'lobby') {
    return (
      <Lobby
        room={room}
        snap={snap}
        profile={profile}
        onExit={room.mode === 'online' ? leave : onExit}
        header={<BrandHeader theme={theme} setTheme={setTheme} compact />}
      />
    );
  }
  return (
    <Table
      room={room}
      snap={snap}
      feed={feed}
      theme={theme}
      setTheme={setTheme}
      onExit={onExit}
      onLeave={leave}
      openRules={openRules}
      paused={rulesOpen}
    />
  );
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [profile, setProfileState] = useState(
    () => load('profile', null) || { name: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)] },
  );
  const setProfile = (p) => {
    setProfileState(p);
    save('profile', p);
  };
  const urlCode = useMemo(codeFromUrl, []);
  const [room, setRoom] = useState(null);
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(() => !!(urlCode && roomCreds(urlCode)));
  const [, refresh] = useState(0);

  const enter = useCallback((r) => {
    // Never leave an old room polling in the background.
    setRoom((old) => {
      if (old && old !== r) old.close();
      return r;
    });
    setError(null);
    if (r.mode === 'online') setUrlRoom(r.code);
    window.scrollTo(0, 0);
  }, []);

  const exit = useCallback(() => {
    setRoom((r) => {
      r?.close();
      return null;
    });
    setUrlRoom(null);
    refresh((x) => x + 1);
  }, []);

  const join = useCallback(
    async (code) => {
      setBusy(true);
      setError(null);
      const res = await joinOnlineRoom(code, { name: profile.name, avatar: profile.avatar }, roomCreds(code));
      setBusy(false);
      setBooting(false);
      if (res.error) {
        setError(res.error);
        if (res.status === 404 || res.status === 403) setUrlRoom(null);
        return;
      }
      enter(res.room);
    },
    [profile.name, profile.avatar, enter],
  );

  // Opening an invite link (or reloading) drops you back into your room.
  // (The ref makes sure this happens once, even in React's development mode.)
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (booting) join(urlCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createOnline = async (target) => {
    setBusy(true);
    setError(null);
    const res = await createOnlineRoom({ name: profile.name.trim(), avatar: profile.avatar }, target);
    setBusy(false);
    if (res.error) setError(res.error);
    else enter(res.room);
  };

  const playLocal = (target) => enter(newLocalRoom({ name: profile.name.trim(), avatar: profile.avatar }, target));

  // "Pick up where you left off": the online room and/or the saved game on
  // this device, most recent first.
  const resumes = [];
  if (!room) {
    const last = load('lastRoom', null);
    const creds = last && roomCreds(last);
    if (creds) {
      resumes.push({ key: 'online', at: creds.at || 0, title: `Back to room ${last}`, sub: 'Rejoin your online game', onClick: () => join(last) });
    }
    const localAt = savedLocalGameAt();
    if (localAt) {
      resumes.push({
        key: 'local',
        at: localAt,
        title: 'Resume your game on this device',
        sub: 'It was saved where you left off',
        onClick: () => {
          const r = resumeLocalRoom();
          if (r) enter(r);
        },
      });
    }
    resumes.sort((a, b) => b.at - a.at);
  }

  let screen;
  if (booting) {
    screen = (
      <div className="page center-page">
        <Loader2 className="spin" size={32} aria-label="Joining room" />
      </div>
    );
  } else if (room) {
    screen = (
      <RoomScreen
        room={room}
        profile={profile}
        theme={theme}
        setTheme={setTheme}
        onExit={exit}
        openRules={() => setRules(true)}
        rulesOpen={rules}
      />
    );
  } else {
    screen = (
      <Home
        profile={profile}
        setProfile={setProfile}
        theme={theme}
        setTheme={setTheme}
        openRules={() => setRules(true)}
        busy={busy}
        error={error}
        clearError={() => setError(null)}
        prefillCode={urlCode}
        resumes={resumes}
        onCreateOnline={createOnline}
        onPlayLocal={playLocal}
        onJoin={join}
      />
    );
  }

  return (
    <>
      <div className="screen" aria-hidden={rules || undefined} inert={rules || undefined}>{screen}</div>
      {rules && (
        <div className="rules-overlay">
          <Rules onClose={() => setRules(false)} />
        </div>
      )}
    </>
  );
}
