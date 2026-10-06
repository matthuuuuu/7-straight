import { useEffect, useRef, useState } from 'react';
import { applyEvent, eventDelay, replaySpeed, toDisplay } from './display.js';

/**
 * Plays the game's new events one at a time so everyone can follow along.
 * Returns { display, busy } — busy is true while a replay is running (the
 * Hit/Stay buttons wait for it to finish).
 */
export function useReplay(game, onEvent) {
  const [display, setDisplay] = useState(() => (game ? toDisplay(game) : null));
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  if (!ref.current) ref.current = { seq: game?.seq ?? 0, queue: [], target: game, timer: 0, display };
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => () => clearTimeout(ref.current.timer), []);

  useEffect(() => {
    const s = ref.current;
    if (!game) return;
    s.target = game;

    const pump = () => {
      const e = s.queue.shift();
      if (!e) {
        s.timer = 0;
        s.display = toDisplay(s.target);
        setDisplay(s.display);
        setBusy(false);
        return;
      }
      s.display = applyEvent(s.display, e, s.target.players.length);
      setDisplay(s.display);
      setBusy(true);
      onEventRef.current?.(e);
      s.timer = setTimeout(pump, eventDelay(e) * replaySpeed(s.queue.length));
    };

    const fresh = game.events.filter((e) => e.seq > s.seq);
    if (!fresh.length) {
      if (!s.timer) {
        s.display = toDisplay(game);
        setDisplay(s.display);
      }
      return;
    }
    const gap = fresh[0].seq !== s.seq + 1;
    s.seq = fresh[fresh.length - 1].seq;
    if (!s.display || gap || fresh.length > 80 || document.hidden) {
      // Too much to replay (or we missed some): jump straight to now.
      clearTimeout(s.timer);
      s.timer = 0;
      s.queue = [];
      s.display = toDisplay(game);
      setDisplay(s.display);
      setBusy(false);
      return;
    }
    s.queue.push(...fresh);
    if (!s.timer) pump();
  }, [game]);

  return { display, busy };
}
