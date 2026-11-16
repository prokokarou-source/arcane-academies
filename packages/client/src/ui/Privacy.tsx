import { useT } from './context';

export const ISSUES_URL = 'https://github.com/prokokarou-source/arcane-academies/issues';

/** Plain-English privacy notice (English only, like the rest of the game UI). Also opens at /privacy. */
export function Privacy({ onBack }: { onBack(): void }) {
  const t = useT();
  return (
    <main className="screen rules">
      <h2>{t('privacy')}</h2>
      <p className="rules-lead">Arcane Academies keeps as little about you as it can. You can always play as a guest without an account.</p>

      <h3>What we store</h3>
      <ul>
        <li>
          <strong>Guests:</strong> nothing on our server once the room closes. Your name and settings stay on your own device.
        </li>
        <li>
          <strong>With an account:</strong> your username, your password as a one-way hash (never the password itself), your sign-in
          sessions, your friends and friend requests, and your game results if they are saved to your account.
        </li>
        <li>
          <strong>Crash reports:</strong> when the app breaks, it sends the error text, the app version and the page. No names, no
          passwords, no tokens.
        </li>
      </ul>

      <h3>What we don't do</h3>
      <ul>
        <li>No email address or phone number is asked for.</li>
        <li>No ads, no analytics, no tracking cookies, and nothing is sold or shared.</li>
      </ul>

      <h3>Where it lives</h3>
      <p>
        The game server runs on <strong>Render</strong>. Accounts and friends are kept in a <strong>Neon</strong> Postgres database. Both
        may keep short technical logs (like IP addresses) to run their service.
      </p>

      <h3>Deleting your account</h3>
      <p>
        Sign in and open the <strong>Account</strong> screen. If you don't see a delete option there yet, open an issue on GitHub with
        your username and we will delete the account and everything linked to it.
      </p>

      <h3>Contact</h3>
      <p>
        Questions or requests:{' '}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          GitHub issues
        </a>
        .
      </p>

      <button onClick={onBack}>{t('back')}</button>
    </main>
  );
}
