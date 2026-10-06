import { useState } from 'react';
import {
  ChevronLeft, Share2, Copy, Check, Bot, UserPlus, X, Crown, Play, LogOut,
} from 'lucide-react';
import { MAX_PLAYERS } from '../engine/engine.js';
import { MAX_NAME_LENGTH } from '../config.js';
import { Avatar, QRCode, Ribbon, useCopy } from './bits.jsx';

const MODES = [
  { target: 200, title: 'Race to 200', sub: 'The official rules' },
  { target: 100, title: 'Race to 100', sub: 'A quicker game' },
];

function TargetTiles({ target, canEdit, onPick }) {
  return (
    <div className="tiles" role="radiogroup" aria-label="Game length">
      {MODES.map((m) => (
        <button
          key={m.target}
          role="radio"
          aria-checked={target === m.target}
          className={`tile ${target === m.target ? 'on' : ''}`}
          disabled={!canEdit && target !== m.target}
          onClick={() => canEdit && onPick(m.target)}
        >
          <b>{m.title}</b>
          <small>{m.sub}</small>
        </button>
      ))}
    </div>
  );
}

function PlayerRows({ view, canKick, onKick, mode }) {
  const g = view.game;
  const humans = g.players.filter((p) => !p.bot).length;
  // On one device, keep at least one person at the table (someone has to deal).
  const removable = (p) => canKick && p.id !== view.youId && !(mode === 'local' && !p.bot && humans <= 1);
  return (
    <ul className="player-rows">
      {g.players.map((p) => {
        const away = view.away.includes(p.id);
        return (
          <li key={p.id} className="player-row">
            <Avatar emoji={p.avatar} size={40} bot={p.bot} away={away} />
            <span className="player-row-name">
              <b>{p.name}</b>
              <span className="badges">
                {p.id === view.youId && <span className="badge you">You</span>}
                {mode === 'online' && p.id === view.hostId && (
                  <span className="badge host"><Crown size={12} aria-hidden="true" /> Host</span>
                )}
                {p.bot && <span className="badge">Bot</span>}
                {away && <span className="badge warn">Away</span>}
              </span>
            </span>
            {removable(p) && (
              <button className="icon-btn" onClick={() => onKick(p.id)} aria-label={`Remove ${p.name}`}>
                <X size={18} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Lobby({ room, snap, profile, onExit, header }) {
  const view = snap.view;
  const g = view.game;
  const online = snap.mode === 'online';
  const host = snap.isHost;
  const seated = !online || view.you >= 0;
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [newName, setNewName] = useState('');
  const [copied, copy] = useCopy();
  const full = g.players.length >= MAX_PLAYERS;
  const link = online ? `${window.location.origin}/?room=${view.code}` : '';
  const hostName = g.players.find((p) => p.id === view.hostId)?.name || 'the host';

  const run = async (fn) => {
    setSending(true);
    let err;
    try {
      err = await fn();
    } catch {
      err = 'That didn’t work. Try again.';
    } finally {
      setSending(false);
    }
    setError(err);
    return err;
  };
  const send = (action) => run(() => room.send(action));
  const takeSeat = () => run(() => room.takeSeat({ name: profile?.name, avatar: profile?.avatar }));

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my 7 Straight game', text: `Room code ${view.code}`, url: link });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    copy(link);
  };

  return (
    <div className="page lobby">
      <div className="lobby-top">
        <button className="btn btn-ghost btn-sm" onClick={onExit}>
          <ChevronLeft size={18} aria-hidden="true" /> {online ? 'Leave' : 'Back'}
        </button>
        {header}
      </div>

      {online && (
        <section className="panel invite">
          <Ribbon>Invite friends</Ribbon>
          <div className="invite-grid">
            <div>
              <p className="muted small">Room code</p>
              <div className="code-tiles" aria-label={`Room code ${view.code.split('').join(' ')}`}>
                {view.code.split('').map((ch, i) => (
                  <span key={i} className="code-tile">{ch}</span>
                ))}
              </div>
              <p className="muted small invite-help">
                Friends open this website on their phone and type the code, or scan the QR code.
              </p>
              <div className="invite-actions">
                <button className="btn btn-primary btn-sm" onClick={share}>
                  <Share2 size={16} aria-hidden="true" /> Share invite
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(link)}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </div>
            <QRCode text={link} size={150} />
          </div>
        </section>
      )}

      <section className="panel">
        <div className="ribbon-row">
          <Ribbon>{online ? 'At the table' : 'Players on this device'}</Ribbon>
          <span className="count-pill">{g.players.length}/{MAX_PLAYERS}</span>
        </div>
        <PlayerRows view={view} mode={snap.mode} canKick={host} onKick={(id) => send({ type: 'kick', id })} />

        {!online && (
          <form
            className="join-row add-human"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!(await send({ type: 'addHuman', name: newName }))) setNewName('');
            }}
          >
            <input
              className="field"
              placeholder="Add a friend’s name"
              value={newName}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setNewName(e.target.value)}
              disabled={full}
              aria-label="Friend’s name"
            />
            <button className="btn btn-ghost" disabled={full || !newName.trim() || sending}>
              <UserPlus size={18} aria-hidden="true" /> Add
            </button>
          </form>
        )}

        {host && (
          <button className="btn btn-ghost btn-block add-bot" disabled={full || sending} onClick={() => send({ type: 'addBot' })}>
            <Bot size={18} aria-hidden="true" /> Add a computer player
          </button>
        )}
        {online && !host && seated && <p className="muted small">The host can add computer players.</p>}
      </section>

      <section className="panel">
        <Ribbon>Game length</Ribbon>
        <TargetTiles target={g.settings.target} canEdit={host} onPick={(t) => send({ type: 'setTarget', target: t })} />
        {g.players.length === 1 && (
          <p className="muted small">
            Playing solo? The rulebook’s challenge: how many rounds does it take you to reach {g.settings.target}?
          </p>
        )}
      </section>

      {snap.notice && !seated && <p className="notice info" role="status">{snap.notice}</p>}
      {error && <p className="notice bad" role="alert">{error}</p>}

      <div className="lobby-start">
        {!seated ? (
          <button className="btn btn-primary btn-block btn-xl" disabled={sending || full} onClick={takeSeat}>
            <UserPlus size={20} aria-hidden="true" /> {full ? 'The table is full' : 'Take a seat'}
          </button>
        ) : host ? (
          <button className="btn btn-primary btn-block btn-xl" disabled={sending || !g.players.length} onClick={() => send({ type: 'start' })}>
            <Play size={20} aria-hidden="true" /> {g.players.length === 1 ? 'Start solo game' : 'Start game'}
          </button>
        ) : (
          <div className="waiting">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
            Waiting for {hostName} to start the game…
          </div>
        )}
        {online && (
          <button className="text-btn leave-link" onClick={onExit}>
            <LogOut size={16} aria-hidden="true" /> Leave room
          </button>
        )}
      </div>
    </div>
  );
}
