import { useT } from './context';

export function Rules({ onBack }: { onBack(): void }) {
  const t = useT();
  return (
    <main className="screen">
      <h2>{t('rules')}</h2>
      {t('rulesText')
        .split('\n')
        .map((p) => (
          <p key={p}>{p}</p>
        ))}
      <button onClick={onBack}>{t('back')}</button>
    </main>
  );
}
