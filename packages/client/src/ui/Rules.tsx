import type { ReactNode } from 'react';
import { ACADEMIES } from '@arcane/engine';
import type { Family } from '@arcane/engine';
import type { StringKey } from '../i18n/strings';
import { useT } from './context';

/**
 * Beginner rules (English only, like the rest of the game UI). Every number here comes from the engine:
 * setup.ts (3 coins, 7 cards, Rival Archmage), actions.ts (pass direction, Sell +3, no duplicate names),
 * payment.ts (trade price 2 / 1, what neighbours can sell), duels.ts (+1/+3/+5, -1),
 * scoring.ts (coins / 3, research formula, tie-break). Academy powers are read from the engine data.
 */

function Fam({ f, children }: { f: Family; children: ReactNode }) {
  return (
    <strong className={`rules-fam fam-${f}`}>
      <span className="swatch" aria-hidden="true" /> {children}
    </strong>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="rules-sec" open={open}>
      <summary>{title}</summary>
      <div className="rules-body">{children}</div>
    </details>
  );
}

function Example({ children }: { children: ReactNode }) {
  return (
    <p className="rules-ex">
      <em>Example:</em> {children}
    </p>
  );
}

export function Rules({ onBack }: { onBack(): void }) {
  const t = useT();
  const res = (r: string) => t(`res_${r}` as StringKey);
  return (
    <main className="screen rules">
      <h2>{t('rules')}</h2>
      <p className="rules-lead">
        Lead a school of magic. Over three Terms you pick cards, build up your academy and raise its tower. After Term III the player with the most{' '}
        <strong>Renown</strong> wins.
      </p>

      <Section title="1. The goal" open>
        <p>Renown is your score. You earn it from buildings, your tower, research, duels with your neighbours and leftover coins.</p>
        <p>2 to 7 players, one phone each. Bots can fill empty seats.</p>
      </Section>

      <Section title="2. Setting up">
        <ul>
          <li>
            Everyone gets an <strong>academy</strong> and starts with <strong>3 coins</strong>.
          </li>
          <li>
            Your academy already produces <strong>1 home resource</strong>, from the very first turn.
          </li>
          <li>
            You sit in a circle. You only deal with the two players next to you: your <strong>left</strong> and <strong>right</strong> neighbours.
          </li>
          <li>
            With 2 players, a <strong>Rival Archmage</strong> sits between you. It plays by itself and you can trade and duel with it, but it can never win.
          </li>
        </ul>
      </Section>

      <Section title="3. How a turn works">
        <p>
          The game has 3 Terms of 6 turns. At the start of each Term everyone gets a hand of <strong>7 cards</strong>.
        </p>
        <ol>
          <li>
            Everyone picks <strong>one card</strong> from their hand at the same time.
          </li>
          <li>When everyone has picked, all picks happen together.</li>
          <li>You pass the rest of your hand to a neighbour and get a new hand from the other side.</li>
        </ol>
        <p>
          <strong>Passing:</strong> Terms I and III pass to the <strong>left</strong>. Term II passes to the <strong>right</strong>.
        </p>
        <p>After 6 turns one card is left in each hand. It is thrown away, and then the duels happen.</p>
        <p>If the room has a turn timer and it runs out, a bot picks for you.</p>
      </Section>

      <Section title="4. What to do with your card">
        <p>With the card you picked you do exactly one of these:</p>
        <ul>
          <li>
            <strong>Build</strong> it: pay its cost and place it in front of you. It works for the rest of the game. You can't own two cards with the same name.
          </li>
          <li>
            <strong>Tower</strong>: tuck it under your academy to build your next tower level. What the card shows doesn't matter; you pay the tower level's cost instead.
          </li>
          <li>
            <strong>Sell +3</strong>: throw it away and take 3 coins. You can always do this.
          </li>
        </ul>
        <Example>None of your cards is affordable and your tower is too expensive. Sell one: +3 coins to spend on the next turns.</Example>
      </Section>

      <Section title="5. Paying for things">
        <ul>
          <li>
            Some cards are <strong>free</strong>, some cost <strong>coins</strong> (paid to the bank), most cost <strong>resources</strong>.
          </li>
          <li>
            Resources are <strong>never used up</strong>. If you produce 1 Ore, you have that Ore again on every turn, for every build.
          </li>
          <li>A card that produces "Herbs or Ore" gives one of them each time you pay, your choice.</li>
          <li>Coins you get this turn (from selling or trading) arrive after the turn. You can only spend what you had at its start.</li>
        </ul>
        <p>
          Basic resources: {res('herbs')}, {res('ore')}, {res('ink')}, {res('moonstone')}.
          <br />
          Rare resources: {res('essence')}, {res('starglass')}, {res('dragonscale')}.
        </p>
        <Example>A card costs 2 Ore. Your home resource is Ore and you built Iron Seam (1 Ore). You pay with those two and spend no coins.</Example>
      </Section>

      <Section title="6. Buying from neighbours">
        <ul>
          <li>
            Missing a resource? Buy it from your left or right neighbour for <strong>2 coins</strong> each. The coins go to that neighbour.
          </li>
          <li>Buying takes nothing away from them. They can still use it themselves.</li>
          <li>
            You can buy their <strong>home resource</strong> and anything their cards produce, Trade cards included.
          </li>
          <li>Some Trade cards lower the price to 1 coin.</li>
          <li>The game works out the cheapest way to pay. You can change the trades before you confirm.</li>
        </ul>
        <Example>You need 1 Ink and have none. Your right neighbour produces Ink. You pay them 2 coins and build the card.</Example>
      </Section>

      <Section title="7. Chains: building for free">
        <p>Many Term II and III cards name an earlier card. If you already own that card, you build the new one for free: no resources, no coins.</p>
        <Example>You built Practice Yard in Term I. In Term II, Dueling Grounds is free for you.</Example>
        <p>Tap a card to see what it chains from and what it unlocks later.</p>
      </Section>

      <Section title="8. Your academy tower">
        <ul>
          <li>Each academy has a tower. You build its levels in order, from the bottom up.</li>
          <li>To build a level, pick any card, pay that level's cost (shown on your board) and the card goes under the tower.</li>
          <li>Levels give Renown, and one level unlocks your academy's power.</li>
          <li>
            Side <strong>A</strong> has 3 levels. Side <strong>B</strong> has 2 or 3 levels with different costs and rewards. Sides are set in the lobby.
          </li>
          <li>You don't have to finish your tower.</li>
        </ul>
        <h4>Academy powers</h4>
        <ul className="rules-powers">
          {ACADEMIES.map((a) => {
            const power = a.sides.A.find((st) => st.power)?.power;
            return (
              <li key={a.id}>
                <strong>{a.name}</strong> <span className="muted">(home: {res(a.home)})</span>
                {power && <> — {t(`power_${power}` as StringKey)}</>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="9. Card families">
        <ul className="rules-fams">
          <li>
            <Fam f="basic">Basic</Fam> — produce basic resources. Terms I and II only.
          </li>
          <li>
            <Fam f="rare">Rare</Fam> — produce rare resources. Terms I and II only.
          </li>
          <li>
            <Fam f="lore">Lore</Fam> — plain Renown at game end.
          </li>
          <li>
            <Fam f="trade">Trade</Fam> — cheaper buying, one-off coins, resources of your choice, and in Term III coins plus Renown for what you own.
          </li>
          <li>
            <Fam f="duel">Dueling</Fam> — duel power for the duels at the end of each Term.
          </li>
          <li>
            <Fam f="research">Research</Fam> — one symbol each: {t('disc_alchemy')}, {t('disc_astronomy')} or {t('disc_runes')}. They score together at the end.
          </li>
          <li>
            <Fam f="patron">Patron</Fam> — Term III only. Renown for cards or tower levels that you (and sometimes your neighbours) own.
          </li>
        </ul>
        <p>Term III has no resource cards, so build your production early.</p>
      </Section>

      <Section title="10. Duels">
        <p>At the end of every Term, compare your total duel power with each neighbour, one at a time.</p>
        <ul>
          <li>
            More power: you win <strong>+1</strong> Renown in Term I, <strong>+3</strong> in Term II, <strong>+5</strong> in Term III.
          </li>
          <li>
            Less power: <strong>−1</strong> Renown.
          </li>
          <li>Same power: nothing happens.</li>
        </ul>
        <p>Duel power adds up over the whole game. Cards from earlier Terms keep counting.</p>
        <Example>Term II. You have 3 power, your left neighbour 1, your right neighbour 4. You win +3 on the left and lose −1 on the right.</Example>
      </Section>

      <Section title="11. Research">
        <ul>
          <li>
            <strong>2 Renown</strong> per research symbol.
          </li>
          <li>
            <strong>+6</strong> for every full set of all three symbols.
          </li>
          <li>
            <strong>+5</strong> for each symbol you have 3 or more of.
          </li>
        </ul>
        <Example>2 Alchemy, 1 Astronomy, 1 Runes: 4 symbols × 2 = 8, plus 1 full set = 6. Total 14 Renown.</Example>
      </Section>

      <Section title="12. End of the game">
        <p>After the Term III duels everyone adds up their Renown:</p>
        <ul>
          <li>Duels won and lost</li>
          <li>1 Renown for every 3 coins</li>
          <li>Tower levels (and some academy powers)</li>
          <li>Lore, Trade and Patron cards</li>
          <li>Research</li>
        </ul>
        <p>Most Renown wins. A tie goes to the player with more coins. If still tied, they share the win.</p>
      </Section>

      <Section title="Tips for your first game">
        <ul>
          <li>Term I: take resource cards. They are cheap and help on every later turn.</li>
          <li>Keep an eye on your neighbours' duel power.</li>
          <li>Look for chains. A free build later saves a lot.</li>
          <li>Stuck? Selling for 3 coins is never a wasted turn.</li>
          <li>Before you pick, think about what the next player will get.</li>
        </ul>
      </Section>

      <button onClick={onBack}>{t('back')}</button>
    </main>
  );
}
