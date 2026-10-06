import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Menu, ListOrdered, BookOpen, LogOut, Crown, WifiOff, ChevronUp, RotateCcw, Users, Trophy,
} from 'lucide-react';
import { CARDS, isNumber, scoreLine, ACTION_NAMES } from '../engine/cards.js';
import { bustChance, hasSecondChance } from '../engine/engine.js';
import { Card, CardBack } from './Card.jsx';
import { Avatar, Sheet, Confetti, ThemeDots, Toggle } from './bits.jsx';
import { load, save } from '../net/storage.js';

const cls = (...xs) => xs.filter(Boolean).join(' ');

function useMedia(query) {
  const get = () => window.matchMedia?.(query).matches ?? false;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const fn = () => setMatch(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return match;
}

function splitLine(line) {
  return {
    nums: line.filter(isNumber),
    extras: line.filter((id) => !isNumber(id)),
  };
}

const roundPoints = (line, status) => (status === 'busted' ? 0 : scoreLine(line).total);

function statusLabel(dp, { isTurn, isActor }) {
  if (dp.lucky) return { text: '7 Straight!', tone: 'great' };
  if (dp.status === 'busted') return { text: 'Busted', tone: 'bad' };
  if (dp.status === 'frozen') return { text: 'Frozen', tone: 'ice' };
  if (dp.status === 'stayed') return { text: 'Stayed', tone: 'done' };
  if (isTurn) return { text: 'Hit or stay?', tone: 'turn' };
  if (isActor) return { text: 'Choosing…', tone: 'turn' };
  return { text: 'In the round', tone: 'plain' };
}

const FLASH_TEXT = { saved: 'SAVED!', flip3: 'FLIP 3!', second: '2ND CHANCE', freeze: 'FROZEN!', lucky: '7 STRAIGHT!', bust: 'BUST!' };

function Flash({ kind }) {
  if (kind === 'bust' || kind === 'lucky') return null; // these get a lasting stamp instead
  return <span className={`flash flash-${kind}`} aria-hidden="true">{FLASH_TEXT[kind]}</span>;
}

function Board({ seat, game, d, view, isYou, cardSize, dealer }) {
  const p = game.players[seat];
  const dp = d.players[seat];
  if (!p || !dp) return null;
  const { nums, extras } = splitLine(dp.line);
  const pts = roundPoints(dp.line, dp.status);
  const target = game.settings.target;
  const isTurn = d.turn === seat;
  const isActor = d.actor === seat;
  const away = view.away.includes(p.id);
  const status = statusLabel(dp, { isTurn, isActor });
  const dup = dp.status === 'busted' ? nums[nums.length - 1] : null;
  const empty = !dp.line.length && !dp.hand.length && !dp.aside.length;

  return (
    <article
      className={cls('board', `st-${dp.status}`, isTurn && 'turn', isActor && 'actor', dp.lucky && 'lucky', isYou && 'you')}
      aria-label={`${p.name}: ${p.total} points, ${pts} this round, ${status.text}`}
    >
      <header className="board-head">
        <Avatar emoji={p.avatar} size={38} bot={p.bot} away={away} />
        <div className="board-who">
          <b className="board-name">{p.name}</b>
          <span className="badges">
            {isYou && <span className="badge you">You</span>}
            {seat === dealer && <span className="badge dealer">Dealer</span>}
            {away && <span className="badge warn">{p.left ? 'Left · autopilot' : 'Away'}</span>}
          </span>
        </div>
        <div className="board-total">
          <b>{p.total}</b>
          <small>/{target}</small>
        </div>
      </header>
      <div className="progress" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (p.total / target) * 100)}%` }} />
      </div>
      <div className="board-cards">
        {empty && <span className="empty-line">No cards yet</span>}
        {nums.length > 0 && (
          <div className="nums">
            {nums.map((id) => <Card key={id} id={id} size={cardSize} highlight={id === dup ? 'dup' : null} />)}
          </div>
        )}
        {extras.length > 0 && (
          <div className="extras">
            {extras.map((id) => <Card key={id} id={id} size={cardSize} />)}
          </div>
        )}
        {(dp.hand.length > 0 || dp.aside.length > 0) && (
          <div className="extras waiting-cards">
            {dp.hand.map((id) => <Card key={id} id={id} size={cardSize} className="in-hand" />)}
            {dp.aside.map((id) => <Card key={id} id={id} size={cardSize} className="aside" />)}
          </div>
        )}
      </div>
      <footer className="board-foot">
        <span className={`chip ${status.tone}`}>{status.text}</span>
        <span className="round-pts">
          <b>{pts}</b> this round
        </span>
      </footer>
      {dp.status === 'busted' && <span className="stamp bust">BUST!</span>}
      {dp.status === 'frozen' && <span className="stamp frozen">FROZEN</span>}
      {dp.lucky && <span className="stamp lucky">7 STRAIGHT!</span>}
      {dp.flash && <Flash key={dp.flash.seq} kind={dp.flash.kind} />}
    </article>
  );
}

function OddsMeter({ risk, safe }) {
  const pct = Math.round(risk * 100);
  const tone = safe ? 'safe' : pct >= 40 ? 'high' : pct >= 20 ? 'mid' : 'low';
  return (
    <div className={`odds ${tone}`}>
      <div className="odds-bar" aria-hidden="true"><i style={{ width: `${safe ? 0 : Math.max(3, pct)}%` }} /></div>
      <span>
        {safe ? 'Your Second Chance covers a duplicate' : <><b>{pct}%</b> chance the next card busts you</>}
      </span>
    </div>
  );
}

function Dock({ seat, label, game, d, view, busy, decision, sending, showOdds, onHit, onStay, name, big, short }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => document.documentElement.style.setProperty('--dock-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--dock-h', '0px');
    };
  }, []);

  if (seat < 0) {
    return (
      <div className="dock watching" ref={ref}>
        <p className="dock-status">You’re watching. When the host goes back to the lobby, you can take a seat.</p>
      </div>
    );
  }
  const p = game.players[seat];
  const dp = d.players[seat];
  const { nums, extras } = splitLine(dp.line);
  const pts = roundPoints(dp.line, dp.status);
  const myTurn = decision?.kind === 'turn' && !busy;
  const risk = myTurn && showOdds ? bustChance(game, seat) : null;
  const dup = dp.status === 'busted' ? nums[nums.length - 1] : null;
  const size = short ? 34 : big ? 56 : 44;

  let status;
  if (d.phase !== 'playing') status = 'Round over';
  else if (dp.lucky) status = '7 Straight! You flipped seven different numbers. +15';
  else if (dp.status === 'busted') status = 'Busted: no points this round. Hang tight for the next one.';
  else if (dp.status === 'stayed') status = `You banked ${pts}. Waiting for the round to finish…`;
  else if (dp.status === 'frozen') status = `Frozen with ${pts}. Waiting for the round to finish…`;
  else if (busy) status = 'Cards are flipping…';
  else if (game.pending) {
    const P = game.pending;
    if (P.kind === 'target' && P.seat === seat) status = 'Choose who gets the card…';
    else status = P.kind === 'turn' ? `${name(P.seat)} is deciding…` : `${name(P.seat)} is choosing a player…`;
  } else status = 'Dealing…';

  return (
    <div className={cls('dock', myTurn && 'my-turn', `st-${dp.status}`)} ref={ref}>
      <div className="dock-inner">
        <div className="dock-head">
          <Avatar emoji={p.avatar} size={34} />
          <span className="dock-who">
            <b>{label}</b>
            <small>{p.total} / {game.settings.target} total</small>
          </span>
          <span className="dock-pts">
            <b>{pts}</b>
            <small>this round</small>
          </span>
        </div>
        {(nums.length > 0 || extras.length > 0) && (
          <div className="dock-cards">
            {extras.length > 0 && <div className="extras">{extras.map((id) => <Card key={id} id={id} size={size} />)}</div>}
            {nums.length > 0 && (
              <div className="nums">{nums.map((id) => <Card key={id} id={id} size={size} highlight={id === dup ? 'dup' : null} />)}</div>
            )}
          </div>
        )}
        {myTurn ? (
          <>
            {risk !== null && <OddsMeter risk={risk} safe={hasSecondChance(game.players[seat])} />}
            <div className="dock-actions">
              <button className="btn btn-primary btn-xl" onClick={onHit} disabled={sending}>
                Hit
              </button>
              <button className="btn btn-yellow btn-xl" onClick={onStay} disabled={sending || !decision.canStay}>
                {decision.canStay ? <>Stay <small>bank {pts}</small></> : 'Stay'}
              </button>
            </div>
            {!decision.canStay && <p className="dock-note">You need at least one card before you can stay.</p>}
          </>
        ) : (
          <p className="dock-status">{status}</p>
        )}
      </div>
    </div>
  );
}

const TARGET_TEXT = {
  freeze: { title: 'Freeze!', text: 'Pick a player to freeze. They bank the points they have right now and are out for the rest of the round.' },
  flip3: { title: 'Flip Three!', text: 'Pick who must flip the next three cards, one at a time. It stops early if they bust or flip 7 different numbers.' },
  second: { title: 'A spare Second Chance', text: 'You can only hold one at a time, so give this one to another active player.' },
};

function TargetSheet({ decision, game, seat, onPick, sending, showOdds, selfLabel }) {
  const act = CARDS[decision.card].act;
  const info = TARGET_TEXT[act];
  return (
    <Sheet open title={info.title} labelledBy="target-title">
      <div className="target-head">
        <Card id={decision.card} size={78} />
        <div>
          <h2 className="sheet-title" id="target-title">{info.title}</h2>
          <p className="sheet-sub">{info.text}</p>
        </div>
      </div>
      <ul className="target-list">
        {decision.options.map((i) => {
          const p = game.players[i];
          const line = scoreLine(p.line);
          const risk = hasSecondChance(p) ? 0 : bustChance(game, i);
          return (
            <li key={i}>
              <button className="target-btn" disabled={sending} onClick={() => onPick(i)}>
                <Avatar emoji={p.avatar} size={42} bot={p.bot} />
                <span className="target-name">
                  <b>{i === seat ? `${selfLabel} (yourself)` : p.name}</b>
                  <small>
                    {line.total} this round · {line.numbers.length} number{line.numbers.length === 1 ? '' : 's'} · {p.total} total
                    {hasSecondChance(p) ? ' · has a Second Chance' : ''}
                    {showOdds && act !== 'second' && !hasSecondChance(p) ? ` · ${Math.round(risk * 100)}% bust risk` : ''}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function breakdown(p) {
  if (p.status === 'busted') return 'Busted';
  const s = scoreLine(p.line);
  const parts = [];
  if (s.numbers.length) parts.push(`${s.numbers.join(' + ')}${s.numbers.length > 1 ? ` = ${s.sum}` : ''}`);
  if (s.doubled) parts.push(`×2 = ${s.sum * 2}`);
  if (s.plus) parts.push(`+${s.plus} bonus`);
  if (s.lucky) parts.push('+15 for 7 numbers');
  const text = parts.join('  ') || 'No points';
  return p.status === 'frozen' ? `Frozen · ${text}` : text;
}

function RoundSheet({ game, snap, view, sending, onNext, onAgain, onLobby, onLeave, onMinimize, name }) {
  const over = game.phase === 'gameOver';
  const last = game.history[game.history.length - 1];
  const order = game.players.map((p, i) => i).sort((a, b) => game.players[b].total - game.players[a].total);
  const canDeal = snap.mode === 'local' || snap.controllable.length > 0;
  const canRestart = snap.mode === 'local' || snap.isHost;
  const winners = game.winners.map((i) => game.players[i]);
  const solo = game.players.length === 1;

  return (
    <Sheet open title={over ? 'Game over' : `Round ${game.round} results`} labelledBy="round-title" wide>
      {over && <Confetti />}
      <div className="round-head">
        {over ? (
          <>
            <Trophy size={34} className="round-trophy" aria-hidden="true" />
            <h2 className="sheet-title" id="round-title">
              {solo
                ? `${game.players[0].total} points in ${game.round} round${game.round === 1 ? '' : 's'}!`
                : winners.length > 1
                  ? `It’s a tie! ${winners.map((w) => w.name).join(' & ')}`
                  : `${winners[0].name} ${game.winners[0] === view.you ? 'win' : 'wins'}!`}
            </h2>
            <p className="sheet-sub">
              {solo ? `You reached ${game.settings.target}. Can you do it in fewer rounds next time?` : `First past ${game.settings.target} with the highest total takes it.`}
            </p>
          </>
        ) : (
          <>
            <h2 className="sheet-title" id="round-title">Round {game.round} results</h2>
            <p className="sheet-sub">
              {last?.lucky >= 0 ? `${name(last.lucky)} flipped 7 different numbers and ended the round.` : 'Everyone is out, so the round is over.'}
            </p>
          </>
        )}
      </div>
      <ol className="results">
        {order.map((i, rank) => {
          const p = game.players[i];
          const s = last?.scores[i] ?? 0;
          return (
            <li key={p.id} className={cls('result', p.status === 'busted' && 'busted', over && game.winners.includes(i) && 'winner')}>
              <span className="result-rank">{over && game.winners.includes(i) ? <Crown size={18} aria-label="Winner" /> : rank + 1}</span>
              <Avatar emoji={p.avatar} size={36} bot={p.bot} />
              <span className="result-name">
                <b>{name(i)}</b>
                <small>{breakdown(p)}</small>
              </span>
              <span className="result-score">
                <b className={s ? 'plus' : ''}>+{s}</b>
                <small>{p.total}</small>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="sheet-actions">
        {!over && (canDeal ? (
          <button className="btn btn-primary btn-block btn-xl" disabled={sending} onClick={onNext}>
            Deal round {game.round + 1}
          </button>
        ) : (
          <p className="muted center">Waiting for a player to deal the next round…</p>
        ))}
        {over && canRestart && (
          <>
            <button className="btn btn-primary btn-block btn-xl" disabled={sending} onClick={onAgain}>
              <RotateCcw size={18} aria-hidden="true" /> Play again
            </button>
            <button className="btn btn-ghost btn-block" disabled={sending} onClick={onLobby}>
              <Users size={18} aria-hidden="true" /> Change players
            </button>
          </>
        )}
        {over && !canRestart && <p className="muted center">The host can start a rematch.</p>}
        <div className="sheet-row">
          <button className="text-btn" onClick={onMinimize}>
            Look at the table
          </button>
          {over && (
            <button className="text-btn" onClick={onLeave}>
              <LogOut size={16} aria-hidden="true" /> Leave
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Scoreboard({ game, onClose, name }) {
  const totals = game.players.map(() => 0);
  return (
    <Sheet open onClose={onClose} title="Scoreboard" wide>
      <h2 className="sheet-title">Scoreboard</h2>
      <p className="sheet-sub">Race to {game.settings.target}. Busted rounds score 0.</p>
      <div className="score-table-wrap">
        <table className="score-table">
          <thead>
            <tr>
              <th scope="col">Rd</th>
              {game.players.map((p, i) => (
                <th scope="col" key={p.id} title={p.name}>
                  <span aria-hidden="true">{p.avatar}</span>
                  <small>{name(i)}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {game.history.map((h) => (
              <tr key={h.round}>
                <th scope="row">{h.round}</th>
                {h.scores.map((s, i) => {
                  totals[i] += s;
                  return (
                    <td key={i} className={cls(s === 0 && 'zero', h.lucky === i && 'lucky')}>
                      {s}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!game.history.length && (
              <tr>
                <td colSpan={game.players.length + 1} className="muted center">No rounds finished yet.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {game.players.map((p) => <td key={p.id}>{p.total}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </Sheet>
  );
}

function spotlightText(d, game, busy, name, isSelf) {
  if (d.phase === 'roundOver') return 'Round over';
  if (d.phase === 'gameOver') return 'Game over';
  if (busy) return d.focus >= 0 ? `${name(d.focus)} ${isSelf(d.focus) ? 'flip' : 'flips'}…` : 'Dealing…';
  const P = game.pending;
  if (!P) return 'Dealing…';
  if (P.kind === 'turn') return isSelf(P.seat) ? 'Your turn: hit or stay?' : `${name(P.seat)}’s turn`;
  const card = ACTION_NAMES[CARDS[P.card].act];
  return isSelf(P.seat) ? `You drew ${card}: pick a player` : `${name(P.seat)} is choosing who gets ${card}`;
}

export function Table({ room, snap, feed, theme, setTheme, onExit, onLeave, openRules, paused = false }) {
  const view = snap.view;
  const game = view.game;
  const online = snap.mode === 'online';
  const wide = useMedia('(min-width: 760px) and (min-height: 560px)');
  const short = useMedia('(max-height: 520px)'); // phones held sideways
  const { d, busy, toasts, pushToast, name, isSelf } = feed;
  const [sending, setSending] = useState(false);
  const [menu, setMenuState] = useState(false);
  const [scores, setScores] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // Destructive menu items need a second tap ("Tap again to…").
  const [confirm, setConfirm] = useState(null);
  const confirmTimer = useRef(0);
  const setMenu = useCallback((open) => {
    setMenuState(open);
    setConfirm(null);
  }, []);
  const closeMenu = useCallback(() => setMenu(false), [setMenu]);
  const closeScores = useCallback(() => setScores(false), []);
  const armOrRun = (key, fn) => {
    if (confirm === key) {
      setConfirm(null);
      fn();
      return;
    }
    setConfirm(key);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), 4000);
  };
  useEffect(() => () => clearTimeout(confirmTimer.current), []);
  const [showOdds, setShowOddsState] = useState(() => load('showOdds', true));
  const setShowOdds = (v) => {
    setShowOddsState(v);
    save('showOdds', v);
  };

  // Whose controls does this device show?
  const pending = game.pending;
  const pendingHuman = pending && snap.controllable.includes(pending.seat) ? pending.seat : -1;
  const lastLocal = useRef(-1);
  if (!online && pendingHuman >= 0) lastLocal.current = pendingHuman;
  const dockSeat = online ? view.you : (pendingHuman >= 0 ? pendingHuman : lastLocal.current >= 0 ? lastLocal.current : snap.controllable[0] ?? -1);
  const decision = game.phase === 'playing' && pendingHuman >= 0 && pendingHuman === dockSeat ? pending : null;
  const dockLabel = online ? 'You' : dockSeat >= 0 ? `${game.players[dockSeat].name}${decision ? '’s turn' : ''}` : '';

  const sendingRef = useRef(false);
  const send = useCallback(
    async (action) => {
      if (sendingRef.current) return null; // ignore double taps
      sendingRef.current = true;
      setSending(true);
      let err;
      try {
        err = await room.send(action, dockSeat);
      } catch {
        err = 'That didn’t work. Try again.';
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      if (err) pushToast({ text: err, tone: 'bad' });
      return err;
    },
    [room, dockSeat, pushToast],
  );

  // Keyboard: H to hit, S to stay (not while a menu, dialog or the rules are open).
  useEffect(() => {
    if (!decision || decision.kind !== 'turn' || busy || menu || scores || paused) return undefined;
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, [aria-modal="true"]')) return;
      if (document.querySelector('[aria-modal="true"], .rules-overlay')) return;
      if (e.key === 'h' || e.key === 'H') send({ type: 'hit' });
      if ((e.key === 's' || e.key === 'S') && decision.canStay) send({ type: 'stay' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decision, busy, send, menu, scores, paused]);

  useEffect(() => {
    if (d?.phase === 'playing') setMinimized(false);
  }, [d?.phase]);

  if (!d) return null;
  const roundDone = d.phase === 'roundOver' || d.phase === 'gameOver';
  const boardSeats = game.players.map((_, i) => i).filter((i) => !(online && i === view.you));
  // Online: list the others in turn order starting after you.
  const n = game.players.length;
  if (online && view.you >= 0) boardSeats.sort((a, b) => ((a - view.you + n) % n) - ((b - view.you + n) % n));
  const leave = onLeave;
  const exitLocal = () => onExit();

  return (
    <div className={`page table-page ${roundDone && !busy && minimized ? 'has-pill' : ''}`}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu">
          <Menu size={22} />
        </button>
        <div className="topbar-mid">
          <span className="topbar-room">{online ? `Room ${view.code}` : 'This device'}</span>
          <span className="topbar-round">Round {Math.max(1, d.round)} · to {game.settings.target}</span>
        </div>
        <span className="deck-stat" title={`${game.deckCount} cards left in the deck, ${game.discard.length} in the discard pile`}>
          <CardBack size={20} />
          <b>{game.deckCount}</b>
        </span>
        <button className="icon-btn" onClick={() => setScores(true)} aria-label="Scoreboard">
          <ListOrdered size={22} />
        </button>
      </div>

      {snap.status === 'reconnecting' && (
        <div className="conn-banner" role="status">
          <WifiOff size={16} aria-hidden="true" /> Reconnecting… your seat is saved.
        </div>
      )}

      <div className="spotlight" aria-live="polite">{spotlightText(d, game, busy, name, isSelf)}</div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>

      <main className="boards">
        {boardSeats.map((i) => (
          <Board key={game.players[i].id} seat={i} game={game} d={d} view={view} isYou={isSelf(i)} cardSize={wide ? 40 : short ? 30 : 34} dealer={d.dealer} />
        ))}
      </main>

      <Dock
        seat={dockSeat}
        label={dockLabel}
        game={game}
        d={d}
        view={view}
        busy={busy}
        decision={decision}
        sending={sending}
        showOdds={showOdds}
        onHit={() => send({ type: 'hit' })}
        onStay={() => send({ type: 'stay' })}
        name={name}
        big={wide}
        short={short}
      />

      {decision?.kind === 'target' && !busy && (
        <TargetSheet
          decision={decision}
          game={game}
          seat={dockSeat}
          sending={sending}
          showOdds={showOdds}
          selfLabel={online ? 'You' : game.players[dockSeat].name}
          onPick={(t) => send({ type: 'target', target: t })}
        />
      )}

      {roundDone && !busy && !minimized && (
        <RoundSheet
          game={game}
          snap={snap}
          view={view}
          sending={sending}
          name={name}
          onNext={() => send({ type: 'next' })}
          onAgain={() => send({ type: 'again' })}
          onLobby={() => send({ type: 'lobby' })}
          onLeave={leave}
          onMinimize={() => setMinimized(true)}
        />
      )}
      {roundDone && !busy && minimized && (
        <button className="results-pill" onClick={() => setMinimized(false)}>
          <ChevronUp size={18} aria-hidden="true" /> {d.phase === 'gameOver' ? 'Final results' : `Round ${game.round} results`}
        </button>
      )}

      {scores && <Scoreboard game={game} onClose={closeScores} name={name} />}

      <Sheet open={menu} onClose={closeMenu} title="Menu">
        <h2 className="sheet-title">Menu</h2>
        <div className="menu-list">
          <button className="menu-item" onClick={() => { setMenu(false); openRules(); }}>
            <BookOpen size={20} aria-hidden="true" /> How to play
          </button>
          <button className="menu-item" onClick={() => { setMenu(false); setScores(true); }}>
            <ListOrdered size={20} aria-hidden="true" /> Scoreboard
          </button>
          <div className="menu-item static">
            <span>Theme</span>
            <ThemeDots theme={theme} setTheme={setTheme} />
          </div>
          <Toggle checked={showOdds} onChange={setShowOdds} label="Show bust odds" hint="Card counting help on your turn" />
          {(snap.isHost || !online) && game.phase !== 'lobby' && (
            <button
              className={`menu-item ${confirm === 'lobby' ? 'armed' : ''}`}
              onClick={() => armOrRun('lobby', async () => { setMenu(false); await send({ type: 'lobby' }); })}
            >
              <Users size={20} aria-hidden="true" /> {confirm === 'lobby' ? 'Tap again to end the game' : 'End game and change players'}
              <small>{confirm === 'lobby' ? (online ? 'This ends the game for everyone' : 'Scores so far will be lost') : 'Back to the lobby'}</small>
            </button>
          )}
          {online ? (
            <button className={`menu-item danger ${confirm === 'leave' ? 'armed' : ''}`} onClick={() => armOrRun('leave', leave)}>
              <LogOut size={20} aria-hidden="true" /> {confirm === 'leave' ? 'Tap again to leave' : 'Leave room'}
              <small>Autopilot plays out your seat</small>
            </button>
          ) : (
            <button className="menu-item" onClick={exitLocal}>
              <LogOut size={20} aria-hidden="true" /> Exit to home
              <small>Your game is saved on this device</small>
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
