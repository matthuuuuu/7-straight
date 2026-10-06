import { Snowflake, HeartPulse } from 'lucide-react';
import { CARDS, NUMBER_WORDS } from '../engine/cards.js';

// One color per number, taken from the box-art palette.
export const SUIT = {
  0: '#e5604f',
  1: '#a39a86',
  2: '#c3c81e',
  3: '#e3425f',
  4: '#22aec2',
  5: '#27a05a',
  6: '#9a4fb4',
  7: '#ef7b6a',
  8: '#86b94a',
  9: '#f08a24',
  10: '#e5393b',
  11: '#5b8fd6',
  12: '#737a9e',
};

function FlipThreeIcon() {
  return (
    <svg viewBox="0 0 40 40" className="pc-icon" aria-hidden="true">
      <rect x="4" y="9" width="17" height="24" rx="3" transform="rotate(-16 12 21)" fill="#fffaf0" stroke="#2d388f" strokeWidth="2.2" />
      <rect x="11" y="7" width="17" height="24" rx="3" fill="#fffaf0" stroke="#2d388f" strokeWidth="2.2" />
      <rect x="18" y="9" width="17" height="24" rx="3" transform="rotate(16 27 21)" fill="#fffaf0" stroke="#2d388f" strokeWidth="2.2" />
      <text x="26.5" y="27" textAnchor="middle" fontFamily="Roboto Condensed, sans-serif" fontWeight="800" fontSize="15" fill="#2d388f" transform="rotate(16 27 21)">3</text>
    </svg>
  );
}

/**
 * A playing card. `size` is the card width in px. Cards get a flip-in
 * animation when they first appear.
 */
export function Card({ id, size = 40, dim = false, highlight = null, className = '' }) {
  const c = CARDS[id];
  const small = size < 50;
  const style = { '--w': `${size}px` };
  let kind;
  let body;
  let word;
  let label;

  if (c.kind === 'num') {
    kind = c.value === 0 ? 'num zero' : 'num';
    style['--suit'] = SUIT[c.value];
    body = <span className="pc-n" data-n={c.value}>{c.value}</span>;
    word = NUMBER_WORDS[c.value];
    label = `${c.value}`;
  } else if (c.kind === 'mod') {
    kind = 'mod';
    style['--suit'] = '#fffaf0';
    body = <span className="pc-n pc-mod-n">{c.op === 'times' ? '×2' : `+${c.value}`}</span>;
    word = c.op === 'times' ? 'DOUBLE' : 'BONUS';
    label = c.op === 'times' ? 'times 2 modifier' : `plus ${c.value} modifier`;
  } else if (c.act === 'freeze') {
    kind = 'act freeze';
    style['--suit'] = '#2d388f';
    body = <Snowflake className="pc-icon" strokeWidth={2.4} aria-hidden="true" />;
    word = 'FREEZE';
    label = 'Freeze';
  } else if (c.act === 'flip3') {
    kind = 'act flip3';
    style['--suit'] = '#2d388f';
    body = <FlipThreeIcon />;
    word = 'FLIP 3';
    label = 'Flip Three';
  } else {
    kind = 'act second';
    style['--suit'] = '#fffaf0';
    body = <HeartPulse className="pc-icon" strokeWidth={2.4} aria-hidden="true" />;
    word = small ? '2ND' : '2ND CHANCE';
    label = 'Second Chance';
  }

  return (
    <div
      className={`pc ${kind} ${small ? 'sm' : ''} ${dim ? 'dim' : ''} ${highlight ? `hl-${highlight}` : ''} ${className}`}
      style={style}
      role="img"
      aria-label={label}
    >
      {c.kind === 'num' && (
        <>
          <span className="pc-fan tl" />
          <span className="pc-fan br" />
        </>
      )}
      {body}
      {!small || c.kind !== 'num' ? <span className="pc-word">{word}</span> : null}
    </div>
  );
}

/** The back of a card (used for the deck). */
export function CardBack({ size = 22, count }) {
  return (
    <div className="pc-back" style={{ '--w': `${size}px` }} aria-hidden="true">
      <span>7</span>
      {count !== undefined && <b className="pc-back-count">{count}</b>}
    </div>
  );
}
