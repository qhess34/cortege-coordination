// Proposition d'installer l'application sur l'écran d'accueil du téléphone.
import { useState } from 'react';
import { useInstall } from '../install';

const DISMISS = 'cortege.installation.masquee';

export function InstallCard({ compact = false, dismissible = false }: { compact?: boolean; dismissible?: boolean }) {
  const inst = useInstall();
  const [hidden, setHidden] = useState(() => { try { return dismissible && localStorage.getItem(DISMISS) === '1'; } catch { return false; } });
  const [help, setHelp] = useState(false);
  if (inst.installed || hidden) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(DISMISS, '1'); } catch { /* non mémorisé */ } };

  return (
    <div className={'install-card' + (compact ? ' compact' : '')} data-testid="installer">
      <div className="row">
        <span className="grow">📲 <b>Installez l’application</b>{compact ? '' : ' : ouverture en un geste depuis l’écran d’accueil, plein écran, sans barre du navigateur.'}</span>
        {inst.canPrompt
          ? <button className="primary" onClick={() => void inst.prompt()}>Installer</button>
          : <button onClick={() => setHelp(!help)} aria-expanded={help}>Comment ?</button>}
        {dismissible && <button className="link small" onClick={hide} aria-label="Ne plus proposer">✕</button>}
      </div>
      {help && !inst.canPrompt && (
        inst.ios ? (
          <ol className="steps small">
            <li>Ouvrez cette page dans <b>Safari</b>.</li>
            <li>Touchez le bouton <b>Partager</b> (carré avec une flèche vers le haut).</li>
            <li>Choisissez <b>« Sur l’écran d’accueil »</b>, puis <b>Ajouter</b>.</li>
          </ol>
        ) : (
          <ol className="steps small">
            <li>Ouvrez le <b>menu du navigateur</b> (⋮ en haut à droite sur Chrome Android).</li>
            <li>Choisissez <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.</li>
            <li>Sur ordinateur, l’icône d’installation apparaît dans la barre d’adresse.</li>
          </ol>
        )
      )}
    </div>
  );
}
