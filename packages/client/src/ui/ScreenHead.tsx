import { useT } from './context';

/** The top bar of a secondary screen: Back on the left, the title in the middle. Sticks while the page scrolls. */
export function ScreenHead({ title, onBack }: { title: string; onBack?: () => void }) {
  const t = useT();
  return (
    <header className="screen-head">
      {onBack ? (
        <button className="back" onClick={onBack}>
          <span className="chev" aria-hidden="true">
            ‹
          </span>
          {t('back')}
        </button>
      ) : (
        <span />
      )}
      <h2>{title}</h2>
      <span />
    </header>
  );
}
