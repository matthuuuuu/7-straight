import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { CARDS } from '../engine/cards.js';
import { Card } from './Card.jsx';
import { Ribbon } from './bits.jsx';

// Find a card id for the examples.
const find = (pred) => CARDS.find(pred).id;
const N = (v) => find((c) => c.kind === 'num' && c.value === v);
const PLUS = (v) => find((c) => c.kind === 'mod' && c.op === 'plus' && c.value === v);
const TIMES2 = find((c) => c.kind === 'mod' && c.op === 'times');
const ACT = (a) => find((c) => c.act === a);

function Row({ ids, size = 46 }) {
  return (
    <div className="rules-cards">
      {ids.map((id, i) => <Card key={`${id}-${i}`} id={id} size={size} />)}
    </div>
  );
}

export function Rules({ onClose }) {
  useEffect(() => {
    window.scrollTo(0, 0);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="page rules">
      <div className="lobby-top">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <ChevronLeft size={18} aria-hidden="true" /> Back
        </button>
      </div>

      <section className="panel objective">
        <h1 className="objective-title">How to play</h1>
        <p>
          Flip cards one at a time and add up the numbers. Stop whenever you like to keep your points, but if you
          flip a number you already have, you <b>bust</b> and score nothing that round.
          The first player past <b>200</b> wins.
        </p>
      </section>

      <section className="panel">
        <Ribbon>The deck</Ribbon>
        <p>
          94 cards. The bigger the number, the more copies there are: twelve 12s, eleven 11s, and so on down to a
          single 1, plus one 0. High cards score big but are easy to duplicate.
        </p>
        <Row ids={[N(12), N(11), N(10), N(9), N(8), N(7), N(6)]} size={40} />
        <Row ids={[N(5), N(4), N(3), N(2), N(1), N(0)]} size={40} />
        <p className="muted small">The 0 is worth nothing, but it still counts toward the seven-card bonus.</p>
        <p>There are also 6 score modifiers and 9 action cards (3 of each):</p>
        <Row ids={[PLUS(2), PLUS(4), PLUS(6), PLUS(8), PLUS(10), TIMES2]} size={40} />
        <Row ids={[ACT('freeze'), ACT('flip3'), ACT('second')]} size={40} />
      </section>

      <section className="panel">
        <Ribbon>A round</Ribbon>
        <ol className="rules-steps">
          <li>
            <b>The deal.</b> Starting with the player after the dealer (the dealer goes last), everyone gets one card
            face up. If it’s an action card, it’s played right away before the deal continues.
          </li>
          <li>
            <b>Hit or stay.</b> Going around the table, each player still in the round chooses to <b>Hit</b> (flip
            one more card) or <b>Stay</b> (keep your points and sit out the rest of the round). You can only stay
            once you have at least one card.
          </li>
          <li>
            <b>Bust.</b> Flip a number you already have and you’re out with 0 points for the round.
          </li>
          <li>
            <b>7 Straight.</b> Collect seven <i>different</i> numbers and the round ends immediately for everyone. You
            get a 15-point bonus. Modifiers and action cards don’t count toward the seven.
          </li>
          <li>
            The round ends when nobody is left in it (everyone stayed, busted or was frozen), or when someone gets
            a 7 Straight. Everyone who didn’t bust scores their cards.
          </li>
        </ol>
      </section>

      <section className="panel">
        <Ribbon>Action cards</Ribbon>
        <p className="muted small">
          When you flip one, you choose who it goes to: any player still in the round, including yourself. If
          you’re the only one left, it goes to you.
        </p>
        <div className="rules-action">
          <Card id={ACT('freeze')} size={56} />
          <div>
            <b>Freeze</b>
            <p>That player keeps the points they have right now and is out for the rest of the round.</p>
          </div>
        </div>
        <div className="rules-action">
          <Card id={ACT('flip3')} size={56} />
          <div>
            <b>Flip Three</b>
            <p>
              That player must flip the next three cards, one by one (any kind of card counts). It stops early if
              they bust or reach seven numbers. A Second Chance flipped along the way can be used at once. A Freeze
              or Flip Three flipped along the way waits until all three cards are out, then gets played (unless
              they busted).
            </p>
          </div>
        </div>
        <div className="rules-action">
          <Card id={ACT('second')} size={56} />
          <div>
            <b>Second Chance</b>
            <p>
              Keep it. If you flip a duplicate number, the duplicate and the Second Chance are both thrown away and
              you stay in. You can only hold one; if you get another, give it to someone still in the round who
              doesn’t have one (or it’s discarded). Unused ones are discarded when the round ends.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <Ribbon>Scoring</Ribbon>
        <p>Modifiers never make you bust, and you can stay with only a modifier (except ×2, which doubles nothing).</p>
        <ol className="rules-steps">
          <li>Add up your number cards.</li>
          <li>If you have the ×2, double that number total.</li>
          <li>Add any +2 to +10 bonus cards.</li>
          <li>Add 15 if you flipped seven different numbers.</li>
        </ol>
        <div className="rules-example">
          <Row ids={[N(4), N(9), N(6), N(12), TIMES2, PLUS(6)]} size={40} />
          <p>
            4 + 9 + 6 + 12 = <b>31</b>, doubled = <b>62</b>, plus 6 = <b>68 points</b>.
          </p>
        </div>
      </section>

      <section className="panel">
        <Ribbon>Next round &amp; winning</Ribbon>
        <p>
          The deal passes to the next player. Used cards go to a discard pile instead of back into the deck; only
          when the deck runs out is the discard pile shuffled into a new deck (cards on the table stay put).
        </p>
        <p>
          At the end of any round where someone has reached 200, the highest total wins. (If two players tie for
          the top, they share the win.)
        </p>
      </section>

      <section className="panel">
        <Ribbon>Tips for this app</Ribbon>
        <ul className="rules-steps">
          <li>Turn on <b>Show bust odds</b> in the menu to see your chance of busting, from the cards already seen.</li>
          <li>If someone’s phone falls asleep for 30 seconds on their turn, autopilot plays for them until they’re back.</li>
          <li>Only playing with one or two people? Add computer players, or play solo and try to reach 200 in as few rounds as possible.</li>
          <li>On a computer, press <b>H</b> to hit and <b>S</b> to stay.</li>
        </ul>
      </section>

      <button className="btn btn-primary btn-block btn-xl rules-done" onClick={onClose}>Got it</button>
    </div>
  );
}
