import { useEffect, useRef, useState } from 'react';
import type { PublicPlayer } from '@arcane/engine';
import type { SeatStatus } from '@arcane/protocol';
import { duelPowerOf, handOptions, neighbors, passDirection, productionOf, researchOf, towerOf, tradeCost, waitingFor } from '../game/derive';
import { BuiltRow } from './Built';
import { CardInfo } from './CardInfo';
import { CardView } from './CardView';
import { useClient, useClientState, useT } from './context';
import { Deadline } from './Deadline';
import { FamilyCounts } from './Family';
import { CostView, EffectView, ResearchView } from './Glyphs';
import { academyArt, Crest, Icon } from './Icon';
import { AvatarGlyph } from './Avatar';
import { useSound } from '../audio/context';
import { GameEnd } from './GameEnd';
import { useGameFx, useMotion, type GameFx, type Launch } from './gameFx';
import { PlayerPanel } from './PlayerPanel';
import { ReactionBubble, ReactionButton, useReactions, type ShownReaction } from './Reactions';
import { ROMAN, TermEnd } from './TermEnd';

export function Game({ onSettings, onRules }: { onSettings(): void; onRules(): void }) {
  const client = useClient();
  const t = useT();
  const sound = useSound();
  const { game, duels, acting } = useClientState();
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [menu, setMenu] = useState<'closed' | 'open' | 'leave'>('closed');
  const reactions = useReactions();
  const turnKey = game ? `${game.view.term}/${game.view.turn}/${game.view.phase}` : '';
  useEffect(() => setSelected(null), [turnKey]);
  const motion = useMotion();
  const launch = useRef<Launch>(null);
  const fx = useGameFx(game?.view, motion, launch);
  if (!game) return null;

  const { view, legal, seats } = game;
  const me = view.players[view.me];
  const { left, right } = neighbors(view);
  const options = handOptions(view, legal);
  const current = options.find((o) => o.cardUid === selected) ?? null;
  const canAct = legal.length > 0 && view.phase !== 'ended';
  const nameOf = (seat: number) => seats[seat]?.name ?? view.players[seat].config.name;
  const bySeat = new Map<number, ShownReaction>();
  for (const r of reactions.values()) if (r.seat !== null) bySeat.set(r.seat, r);
  const elsewhere = [...bySeat.values()].filter((r) => r.seat !== left && r.seat !== right && r.seat !== view.me);

  let status: string;
  if (view.phase === 'ended') status = '';
  else if (canAct && !acting) status = view.phase === 'bonus' ? t('bonusTurn') : view.phase === 'discard' ? t('discardTurn') : t('pickCard');
  else {
    const names = waitingFor(view, seats);
    status = names === null ? t('waitingBonus') : names.length ? t('waitingFor', { names: names.join(', ') }) : t('waitingOthers');
  }

  const build = current?.build;
  const buildCost = build && build.type === 'build' ? tradeCost(build.payment) : 0;
  const tower = towerOf(me);
  const research = researchOf(me);
  const pass = passDirection(view);
  const passHint = (seat: number) => (seat === pass.to ? 'gets' : seat === pass.from ? 'gives' : undefined);
  const showPass = view.phase !== 'ended' && !game.result;
  /** Remember where the chosen card is, so it can fly to my built row once the turn resolves. */
  const markLaunch = (uid: string) => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-testid="card"]')].find((e) => e.dataset.uid === uid);
    const r = el?.getBoundingClientRect();
    launch.current = r ? { uid, x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  };

  return (
    <main className="screen game">
      <header className="game-head">
        <span>{t('term', { n: ROMAN[view.term - 1] })}</span>
        <span>{t('turn', { n: view.turn })}</span>
        {game.deadline !== null && view.phase !== 'ended' && <Deadline deadline={game.deadline} />}
        <span className="coins num" aria-label={t('coins')}>
          {me.coins}
          <Icon name="coin" />
          {fx.coinGain > 0 && (
            <span key={fx.id} className="coin-pop" aria-hidden="true">{`+${fx.coinGain}`}</span>
          )}
        </span>
        <ReactionButton />
        <button className="link icon-btn" aria-label={t('menu')} onClick={() => setMenu('open')}>
          ☰
        </button>
      </header>

      <section className="neighbors">
        <Neighbor side={t('left')} player={view.players[left]} status={seats[left]} reaction={bySeat.get(left)} onClick={() => setInspect(left)}
          onInfo={setInfo} fresh={fx.fresh} pass={showPass ? passHint(left) : undefined} at="left" />
        <button className="table-btn" onClick={() => setTable(true)}>
          {t('table')}
        </button>
        <Neighbor side={t('right')} player={view.players[right]} status={seats[right]} reaction={bySeat.get(right)} onClick={() => setInspect(right)}
          onInfo={setInfo} fresh={fx.fresh} pass={showPass ? passHint(right) : undefined} at="right" />
      </section>
      {showPass && <PassArrow side={pass.side} name={nameOf(pass.to)} fx={fx} covered={!!duels} />}
      {elsewhere.length > 0 && (
        <p className="react-strip">
          {elsewhere.map((r) => (
            <span key={r.seatId}>
              {nameOf(r.seat!)}
              <ReactionBubble reaction={r} name={nameOf(r.seat!)} />
            </span>
          ))}
        </p>
      )}

      <button className={`me has-art${fx.towerUp ? ' tower-up' : ''}`} style={{ ['--art' as string]: `url(${academyArt(me.academyId)})` }} onClick={() => setInspect(view.me)}>
        <ReactionBubble reaction={bySeat.get(view.me)} name={nameOf(view.me)} />
        {fx.towerUp && <span key={fx.id} className="tuck-card" aria-hidden="true" />}
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
      <BuiltRow className="me-built" player={me} name={nameOf(view.me)} onInfo={setInfo} fresh={fx.fresh} />

      <p className="status" role="status">
        {status}
      </p>

      {game.result ? (
        <GameEnd me={view.me} result={game.result} seats={seats} />
      ) : (
      <div key={fx.handFrom ? fx.id : 'hand'} className={`hand${fx.handFrom ? ` slide-from-${fx.handFrom}` : ''}`}>
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
          <button className="primary" disabled={!build || acting} onClick={() => build && (markLaunch(build.cardUid), sound('build'), client.act(build))}>
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
        </div>
      )}

      {table && (
        <div className="sheet-backdrop" onClick={() => setTable(false)}>
          <section className="sheet" role="dialog" aria-label={t('table')} onClick={(e) => e.stopPropagation()}>
            <h3>{t('table')}</h3>
            {view.players.map((p) => (
              <Neighbor key={p.seat} side={p.seat === view.me ? t('you') : ''} player={p} status={seats[p.seat]} reaction={bySeat.get(p.seat)} onClick={() => (setTable(false), setInspect(p.seat))}
                onInfo={setInfo} fresh={fx.fresh} />
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
                <button onClick={onRules}>{t('rules')}</button>
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
      {inspect !== null && <PlayerPanel player={view.players[inspect]} status={seats[inspect]} onClose={() => setInspect(null)} onInfo={setInfo} />}
      {info && <CardInfo defId={info} onClose={() => setInfo(null)} />}
    </main>
  );
}

/**
 * "Cards pass to Bob": who gets my hand after this turn. The arrow flips with a short turn when the Term changes,
 * replayed once the Term-duels sheet that covers it is closed.
 */
function PassArrow({ side, name, fx, covered }: { side: 'left' | 'right'; name: string; fx: GameFx; covered: boolean }) {
  const t = useT();
  const glyph = (
    <span key={fx.termChanged ? `${fx.id}${covered ? '-covered' : ''}` : 'glyph'} className={`pass-glyph${fx.termChanged ? ' flip' : ''}`} aria-hidden="true">
      ➜
    </span>
  );
  return (
    <p className={`pass-arrow to-${side}`} data-side={side}>
      {side === 'left' && glyph}
      <span>{t('passTo', { name })}</span>
      {side === 'right' && glyph}
    </p>
  );
}

function Neighbor(props: {
  side: string;
  player: PublicPlayer;
  status?: SeatStatus;
  reaction?: ShownReaction;
  onClick(): void;
  onInfo(defId: string): void;
  fresh: ReadonlySet<string>;
  pass?: 'gets' | 'gives';
  at?: 'left' | 'right';
}) {
  const t = useT();
  const { player: p, status: s } = props;
  const name = s?.name ?? p.config.name;
  const tags = [s?.kind === 'bot' || s?.botControlled ? t('bot') : '', s && s.kind !== 'archmage' && !s.connected && s.kind === 'human' ? t('offline') : '']
    .filter(Boolean)
    .join(' · ');
  // The arrow points the way the cards travel: from me to the neighbour who gets my hand, towards me from the one who gives.
  const toward = props.pass === 'gets' ? props.at : props.at === 'left' ? 'right' : 'left';
  return (
    <div className="neighbor-col">
    <button className="neighbor" onClick={props.onClick}>
      <span className="neighbor-top">
        <Crest academyId={p.academyId} size={22} />
        <span className="muted small">{props.side}</span>
        {p.hasSubmitted && <span className="ready">✓</span>}
      </span>
      <ReactionBubble reaction={props.reaction} name={name} />
      <span className="name">
        {s?.kind === 'human' && <AvatarGlyph avatar={s.avatar} size={16} />}
        {name}
      </span>
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
      {props.pass && (
        <span className={`pass-hint ${props.pass} to-${toward}`} data-pass={props.pass}>
          <span className="pass-glyph" aria-hidden="true">
            ➜
          </span>
          {t(props.pass === 'gets' ? 'passGets' : 'passGives')}
        </span>
      )}
    </button>
    <BuiltRow player={p} name={name} onInfo={props.onInfo} fresh={props.fresh} />
    </div>
  );
}
