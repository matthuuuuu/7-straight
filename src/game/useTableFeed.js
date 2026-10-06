import { useCallback, useRef } from 'react';
import { useReplay } from './useReplay.js';
import { eventMessage } from './display.js';
import { useToasts } from '../ui/bits.jsx';

/**
 * Everything the table screen shows that changes over time: the replayed
 * table, whether a replay is running, and the event ticker. It lives above
 * the lobby/table switch so the very first deal is animated too.
 */
export function useTableFeed(snap) {
  const [toasts, pushToast] = useToasts();
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const isSelf = useCallback((i) => {
    const s = snapRef.current;
    return s.mode === 'online' && i === s.view?.you;
  }, []);
  const name = useCallback(
    (i) => (isSelf(i) ? 'You' : snapRef.current.view?.game.players[i]?.name ?? 'Someone'),
    [isSelf],
  );

  const onEvent = useCallback(
    (e) => {
      const m = eventMessage(e, name, isSelf);
      if (m) pushToast(m);
      if (e.t === 'bust' && (isSelf(e.p) || snapRef.current.mode === 'local')) navigator.vibrate?.(140);
    },
    [name, isSelf, pushToast],
  );

  const { display, busy } = useReplay(snap.view?.game ?? null, onEvent);
  return { d: display, busy, toasts, pushToast, name, isSelf };
}
