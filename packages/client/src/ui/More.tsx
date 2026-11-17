import type { ReactNode } from 'react';
import { useSound } from '../audio/context';
import type { Lang } from '../i18n/strings';
import { useInstall, usePush } from '../pwa/context';
import { useClient, useClientState, usePrefs, useT } from './context';
import { Glyph, TabScreen } from './Menu';
import { ISSUES_URL } from './Privacy';
import { ScreenHead } from './ScreenHead';

export type MorePage = 'profile' | 'friends' | 'account' | 'news' | 'language' | 'rules' | 'faq' | 'settings' | 'about' | 'privacy';

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'el', label: 'Ελληνικά' },
];

/** Log out here; this device stops getting the account's notifications first. */
export function useLogout() {
  const client = useClient();
  const push = usePush();
  return async () => {
    if (push.store && push.status === 'on') await push.store.disable((e) => client.removePush(e));
    client.logout();
  };
}

function Row(props: { label: string; onClick?: () => void; href?: string; value?: string; danger?: boolean }) {
  const sound = useSound();
  if (props.href)
    return (
      <a className="list-row" href={props.href} target="_blank" rel="noreferrer">
        <span>{props.label}</span>
        <Glyph name="external" size={18} />
      </a>
    );
  return (
    <button className={`list-row${props.danger ? ' danger' : ''}`} onClick={() => (sound('tap'), props.onClick?.())}>
      <span>{props.label}</span>
      {props.value && <span className="muted">{props.value}</span>}
      {!props.danger && <Glyph name="chevron" size={18} />}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="list-group" aria-label={title}>
      <h3>{title}</h3>
      <div className="list-panel">{children}</div>
    </section>
  );
}

export function More({ onOpen }: { onOpen(p: MorePage): void }) {
  const t = useT();
  const [prefs] = usePrefs();
  const { account } = useClientState();
  const install = useInstall();
  const logout = useLogout();
  return (
    <TabScreen className="more">
      <Group title={t('groupAccount')}>
        {account ? (
          <>
            <Row label={t('profileStats')} onClick={() => onOpen('profile')} />
            <Row label={t('friends')} onClick={() => onOpen('friends')} />
            <Row label={t('accountSettings')} onClick={() => onOpen('account')} />
            <Row label={t('logOut')} danger onClick={() => void logout()} />
          </>
        ) : (
          <>
            <Row label={t('signInOrUp')} onClick={() => onOpen('account')} />
            <Row label={t('friends')} onClick={() => onOpen('friends')} />
          </>
        )}
      </Group>
      <Group title={t('groupGame')}>
        <Row label={t('whatsNew')} value={`v${__APP_VERSION__}`} onClick={() => onOpen('news')} />
        <Row label={t('language')} value={LANGS.find((l) => l.id === prefs.lang)?.label} onClick={() => onOpen('language')} />
        <Row label={t('rules')} onClick={() => onOpen('rules')} />
        <Row label={t('faq')} onClick={() => onOpen('faq')} />
        <Row label={t('settings')} onClick={() => onOpen('settings')} />
        {install.canInstall && <Row label={t('installApp')} onClick={install.install} />}
      </Group>
      <Group title={t('groupAbout')}>
        <Row label={t('aboutGame')} onClick={() => onOpen('about')} />
        <Row label={t('privacy')} onClick={() => onOpen('privacy')} />
        <Row label={t('feedback')} href={ISSUES_URL} />
      </Group>
      {install.iosHint && (
        <div className="banner" role="note">
          <span>{t('iosHint')}</span>
          <button className="link" onClick={install.dismissIosHint}>
            {t('gotIt')}
          </button>
        </div>
      )}
    </TabScreen>
  );
}

/** Short changelog, newest first (English, like the rest of the UI). */
export const CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: '0.1.0',
    items: [
      'New menu: Play, Rooms, Leaderboards and More in a bottom bar.',
      'Casual and Ranked queues for 1v1, 3–5 and 6–7 players.',
      'Ranked ratings with four divisions and leaderboards by friends, region and country.',
      'Rooms: public room list, room settings before the lobby, one side for the whole table.',
      'Side and academies are drawn at the start of every game, with a short reveal.',
      'Profiles with ranked tiles, academy stats and your last 10 games.',
    ],
  },
  {
    version: '0.0.9',
    items: ['Block and report players, recovery codes for accounts.', 'Play again with the same table, and avatars.'],
  },
];

export const FAQ: { q: string; a: string }[] = [
  { q: 'Do I need an account?', a: 'No. Guests can play bots, Casual games and rooms. An account keeps your stats, friends and avatar, and is needed for Ranked.' },
  { q: 'Can I play offline?', a: 'Yes. Games against bots run on your phone, so they work without a connection and start at once.' },
  { q: 'What is the difference between Casual and Ranked?', a: 'Both match you with other players. Ranked games change your rating; Casual games only count in your stats.' },
  { q: 'How does the rating work?', a: 'Everyone starts at 1000 in each Ranked mode. Beating stronger players earns more; in bigger tables your place is compared with every other human.' },
  { q: 'What are the divisions?', a: 'Apprentice (below 1100), Adept (1100–1299), Magister (1300–1499) and Archmage (1500 and above).' },
  { q: 'Who is the Rival Archmage?', a: 'In 1v1 games a neutral third academy joins the table, played by the game. It does not count for ratings.' },
  { q: 'How are side and academy chosen?', a: 'The whole table plays the same side (A or B). In matchmaking both are drawn at random; in rooms the host picks the side and each player may pick an academy.' },
  { q: 'How do I play with friends?', a: 'Create a room in the Rooms tab, make it Private and share the code, or invite friends from the lobby.' },
  { q: 'What happens if I lose connection?', a: 'Your seat waits for you. If you are away too long, a bot plays for you until you come back.' },
  { q: 'How do I report a problem?', a: 'Use Feedback under More. It opens the project’s issue page.' },
];

export function WhatsNew({ onBack }: { onBack(): void }) {
  const t = useT();
  return (
    <main className="screen">
      <ScreenHead title={t('whatsNew')} onBack={onBack} />
      {CHANGELOG.map((v) => (
        <section key={v.version} className="panel">
          <h3>{`v${v.version}`}</h3>
          <ul className="changes">
            {v.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

export function Faq({ onBack }: { onBack(): void }) {
  const t = useT();
  return (
    <main className="screen">
      <ScreenHead title={t('faq')} onBack={onBack} />
      <div className="faq">
        {FAQ.map((f) => (
          <details key={f.q} className="panel">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}

export function About({ onBack }: { onBack(): void }) {
  const t = useT();
  return (
    <main className="screen">
      <ScreenHead title={t('aboutGame')} onBack={onBack} />
      <section className="panel">
        <p>
          Arcane Academies is a card-drafting game for 2–7 players, one phone each. Rival schools of magic gather resources, study
          disciplines, duel their neighbours and raise their academy tower over three Terms.
        </p>
        <p className="muted small">{`Version ${__APP_VERSION__}. An independent, original game.`}</p>
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          {t('feedback')}
        </a>
      </section>
    </main>
  );
}

export function LanguagePage({ onBack }: { onBack(): void }) {
  const t = useT();
  const [prefs, setPrefs] = usePrefs();
  return (
    <main className="screen">
      <ScreenHead title={t('language')} onBack={onBack} />
      <div className="list-panel" role="radiogroup" aria-label={t('language')}>
        {LANGS.map((l) => (
          <button key={l.id} role="radio" aria-checked={prefs.lang === l.id} className="list-row" onClick={() => setPrefs({ ...prefs, lang: l.id })}>
            <span>{l.label}</span>
            {prefs.lang === l.id && <span className="tick">✓</span>}
          </button>
        ))}
      </div>
      <p className="hint">{t('languageHint')}</p>
    </main>
  );
}
