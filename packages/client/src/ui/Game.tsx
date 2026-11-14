import { useEffect, useState } from 'react';
import type { PublicPlayer } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';
import { duelPowerOf, handOptions, neighbors, productionOf, researchOf, towerOf, tradeCost, waitingFor } from '../game/derive';
import { CardInfo } from './CardInfo';
import { CardView } from './CardView';
import { useClient, useClientState, useT } from './context';
import { Deadline } from './Deadline';
import { FamilyCounts } from './Family';
import { CostView, EffectView, ResearchView } from './Glyphs';
import { academyArt, Crest, Icon } from './Icon';
import { useSound } from '../audio/context';
import { GameEnd } from './GameEnd';
import { PlayerPanel } from './PlayerPanel';
import { ROMAN, TermEnd } from './TermEnd';

export function Game({ onSettings }: { onSettings(): void }) {
  const client = useClient();
  const t = useT();
  const sound = useSound();
  const { game, duels, acting } = useClientState();
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [menu, setMenu] = useState<'closed' | 'open' | 'leave'>('closed');
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
  if (view.phase === 'ended') status = '';
  else if (canAct && !acting) status = view.phase === 'bonus' ? t('bonusTurn') : t('pickCard');
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
        <span className="coins num" aria-label={t('coins')}>
          {me.coins}
          <Icon name="coin" />
        </span>
        <button className="link small" aria-label={t('menu')} onClick={() => setMenu('open')}>
          ☰
        </button>
      </header>

      <section className="neighbors">
        <Neighbor side={t('left')} player={view.players[left]} status={seats[left]} onClick={() => setInspect(left)} />
        <button className="link small" onClick={() => setTable(true)}>
          {t('table')}
        </button>
        <Neighbor side={t('right')} player={view.players[right]} status={seats[right]} onClick={() => setInspect(right)} />
      </section>

      <button className="me has-art" style={{ ['--art' as string]: `url(${academyArt(me.academyId)})` }} onClick={() => setInspect(view.me)}>
        <span className="me-row">
          <Crest academyId={me.academyId} size={30} />
          {productionOf(me).map((x, i) => (
            <span key={i} className="res">
              <EffectView effect={{ kind: 'produce', ...x }} />
            </span>
          ))}
        </span>
        <span className="me-row small">
          <span className="num">
            <Icon name="duel" />
            {duelPowerOf(me)}
          </span>
          <ResearchView counts={research} />
          <span>{`${t('tower')} ${t('stageOf', { built: tower.built, total: tower.total })}`}</span>
          <span>{`${t('built')} ${me.built.length}`}</span>
          <FamilyCounts player={me} />
        </span>
        <span className="me-row small">
          {tower.next ? (
            <span className="glyphs">
              {t('nextLevelLabel')}
              <CostView cost={tower.next.cost} />
            </span>
          ) : (
            <span>{t('towerDone')}</span>
          )}
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
          <CardView key={o.cardUid} opt={o} selected={o.cardUid === selected} onSelect={() => {
              if (!canAct) return;
              sound('select');
              setSelected(o.cardUid);
            }} onInfo={() => setInfo(o.defId)} />
        ))}
      </div>
      )}

      {canAct && (
        <div className="actions">
          <button className="primary" disabled={!build || acting} onClick={() => build && (sound('build'), client.act(build))}>
            {t('build')}
            {buildCost > 0 && (
              <span className="num cost-chip">
                {buildCost}
                <Icon name="coin" />
              </span>
            )}
          </button>
          <button disabled={!current?.tower || acting} onClick={() => current?.tower && (sound('tower'), client.act(current.tower))}>
            {t('raiseTower')}
          </button>
          <button disabled={!current?.sell || acting} onClick={() => current?.sell && (sound('sell'), client.act(current.sell))}>
            {t('sell')}
          </button>
          {current?.keep && (
            <button disabled={acting} onClick={() => current.keep && (sound('build'), client.act(current.keep))}>
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
      {menu !== 'closed' && (
        <div className="sheet-backdrop" onClick={() => setMenu('closed')}>
          <section className="sheet" role="dialog" aria-label={t('menu')} onClick={(e) => e.stopPropagation()}>
            {menu === 'open' ? (
              <>
                <button onClick={onSettings}>{t('settings')}</button>
                <button onClick={() => setMenu('leave')}>{t('leaveGame')}</button>
                <button className="link" onClick={() => setMenu('closed')}>
                  {t('close')}
                </button>
              </>
            ) : (
              <>
                <p>{seats.some((s) => s.seat !== view.me && s.kind === 'human' && !s.botControlled) ? t('leaveBot') : t('leaveEnd')}</p>
                <button className="primary" onClick={() => client.leave()}>
                  {t('leave')}
                </button>
                <button onClick={() => setMenu('closed')}>{t('stay')}</button>
              </>
            )}
          </section>
        </div>
      )}
      {duels && <TermEnd term={duels.term} view={duels.view} deltas={duels.deltas} seats={seats} onClose={() => client.clearDuels()} />}
      {info && <CardInfo defId={info} onClose={() => setInfo(null)} />}
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
      <span className="neighbor-top">
        <Crest academyId={p.academyId} size={22} />
        <span className="muted small">{props.side}</span>
        {p.hasSubmitted && <span className="ready">✓</span>}
      </span>
      <span className="name">{name}</span>
      <span className="small glyphs">
        <span className="num">
          {p.coins}
          <Icon name="coin" />
        </span>
        <span className="num">
          {duelPowerOf(p)}
          <Icon name="duel" />
        </span>
        <span className="num">▦{p.built.length}</span>
      </span>
      <FamilyCounts player={p} />
      {tags && <span className="tag">{tags}</span>}
    </button>
  );
}
