import { useEffect, useState } from 'react';
import type { PublicPlayer } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';
import { duelPowerOf, handOptions, neighbors, productionOf, researchOf, towerOf, tradeCost, waitingFor } from '../game/derive';
import { CardView } from './CardView';
import { useClient, useClientState, useT } from './context';
import { Deadline } from './Deadline';
import { COIN, costLabel, DISCIPLINE_ICON, DUEL, effectLabel } from './icons';
import { GameEnd } from './GameEnd';
import { PlayerPanel } from './PlayerPanel';
import { ROMAN, TermEnd } from './TermEnd';

export function Game() {
  const client = useClient();
  const t = useT();
  const { game, duels, acting } = useClientState();
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const turnKey = game ? `${game.view.term}/${game.view.turn}/${game.view.phase}` : '';
  useEffect(() => setSelected(null), [turnKey]);
  if (!game) return null;

  const { view, legal, seats } = game;
  const me = view.players[view.me];
  const { left, right } = neighbors(view);
  const options = handOptions(view, legal);
  const current = options.find((o) => o.cardUid === selected) ?? null;
  const canAct = legal.length > 0 && view.phase !== 'ended';
  const nameOf = (seat: number) => seats[seat]?.name ?? view.players[seat].config.name;

  let status: string;
  if (canAct && !acting) status = view.phase === 'bonus' ? t('bonusTurn') : t('pickCard');
  else {
    const names = waitingFor(view, seats);
    status = names === null ? t('waitingBonus') : names.length ? t('waitingFor', { names: names.join(', ') }) : t('waitingOthers');
  }

  const build = current?.build;
  const buildCost = build && build.type === 'build' ? tradeCost(build.payment) : 0;
  const tower = towerOf(me);
  const research = researchOf(me);

  return (
    <main className="screen game">
      <header className="game-head">
        <span>{t('term', { n: ROMAN[view.term - 1] })}</span>
        <span>{t('turn', { n: view.turn })}</span>
        {game.deadline !== null && view.phase !== 'ended' && <Deadline deadline={game.deadline} />}
        <span className="coins" aria-label={t('coins')}>{`${me.coins} ${COIN}`}</span>
      </header>

      <section className="neighbors">
        <Neighbor side={t('left')} player={view.players[left]} status={seats[left]} onClick={() => setInspect(left)} />
        <button className="link small" onClick={() => setTable(true)}>
          {t('table')}
        </button>
        <Neighbor side={t('right')} player={view.players[right]} status={seats[right]} onClick={() => setInspect(right)} />
      </section>

      <button className="me" onClick={() => setInspect(view.me)}>
        <span className="me-row">{productionOf(me).map((x, i) => <span key={i} className="res">{effectLabel({ kind: 'produce', ...x })}</span>)}</span>
        <span className="me-row small">
          <span>{`${DUEL} ${duelPowerOf(me)}`}</span>
          <span>{Object.entries(research).map(([d, n]) => `${DISCIPLINE_ICON[d as keyof typeof research]}${n}`).join(' ')}</span>
          <span>{`${t('tower')} ${t('stageOf', { built: tower.built, total: tower.total })}`}</span>
          <span>{`${t('built')} ${me.built.length}`}</span>
        </span>
        <span className="me-row small">
          <span>{tower.next ? t('nextLevel', { cost: costLabel(tower.next.cost) }) : t('towerDone')}</span>
        </span>
      </button>

      <p className="status" role="status">
        {status}
      </p>

      {game.result ? (
        <GameEnd me={view.me} result={game.result} seats={seats} />
      ) : (
      <div className="hand">
        {options.map((o) => (
          <CardView key={o.cardUid} opt={o} selected={o.cardUid === selected} onSelect={() => canAct && setSelected(o.cardUid)} />
        ))}
      </div>
      )}

      {canAct && (
        <div className="actions">
          <button className="primary" disabled={!build || acting} onClick={() => build && client.act(build)}>
            {buildCost > 0 ? `${t('build')} (${buildCost} ${COIN})` : t('build')}
          </button>
          <button disabled={!current?.tower || acting} onClick={() => current?.tower && client.act(current.tower)}>
            {t('raiseTower')}
          </button>
          <button disabled={!current?.sell || acting} onClick={() => current?.sell && client.act(current.sell)}>
            {t('sell')}
          </button>
          {current?.keep && (
            <button disabled={acting} onClick={() => current.keep && client.act(current.keep)}>
              {t('keep')}
            </button>
          )}
        </div>
      )}

      {table && (
        <div className="sheet-backdrop" onClick={() => setTable(false)}>
          <section className="sheet" role="dialog" aria-label={t('table')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('table')}</h3>
            {view.players.map((p) => (
              <Neighbor key={p.seat} side={p.seat === view.me ? t('you') : ''} player={p} status={seats[p.seat]} onClick={() => (setTable(false), setInspect(p.seat))} />
            ))}
            <button onClick={() => setTable(false)}>{t('close')}</button>
          </section>
        </div>
      )}
      {duels && <TermEnd term={duels.term} view={duels.view} deltas={duels.deltas} seats={seats} onClose={() => client.clearDuels()} />}
      {inspect !== null && <PlayerPanel player={view.players[inspect]} status={seats[inspect]} onClose={() => setInspect(null)} />}
    </main>
  );
}

function Neighbor(props: { side: string; player: PublicPlayer; status?: SeatStatus; onClick(): void }) {
  const t = useT();
  const { player: p, status: s } = props;
  const name = s?.name ?? p.config.name;
  const tags = [s?.kind === 'bot' || s?.botControlled ? t('bot') : '', s && s.kind !== 'archmage' && !s.connected && s.kind === 'human' ? t('offline') : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <button className="neighbor" onClick={props.onClick}>
      <span className="muted small">{props.side}</span>
      <span className="name">{name}</span>
      <span className="small">{`${p.coins}${COIN} ${DUEL}${duelPowerOf(p)} ▦${p.built.length}${p.hasSubmitted ? ' ✓' : ''}`}</span>
      {tags && <span className="tag">{tags}</span>}
    </button>
  );
}
