// Suivi écran éteint : configuration de l'application OwnTracks sur le téléphone du membre.
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { ago } from '../useLive';

export interface OwnTracksState { lastSeenAt: string | null; battery: number | null; expiresAt: string }

export function OwnTracksCard({ teamId, state, reload, notify }: {
  teamId: number; state: OwnTracksState | null; reload: () => Promise<void>; notify: (t: { kind: 'ok' | 'error'; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!link) { setQr(null); return; }
    QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'L' }).then(setQr, () => setQr(null));
  }, [link]);

  const configure = async () => {
    setBusy(true);
    try {
      setLink((await api.post<{ link: string }>('/api/terrain/equipes/' + teamId + '/owntracks')).link);
      await reload();
    } catch (e) {
      notify({ kind: 'error', text: e instanceof ApiError ? e.message : 'Configuration impossible.' });
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!window.confirm('Arrêter le suivi OwnTracks ? Votre position sera effacée ; l’application se mettra au repos à son prochain envoi.')) return;
    await api.delete('/api/terrain/owntracks').catch(() => undefined);
    setLink(null);
    notify({ kind: 'ok', text: 'Suivi OwnTracks arrêté.' });
    await reload();
  };

  if (state && !link) {
    return (
      <div className="card small sharing" data-testid="owntracks">
        <div className="row">
          <span className="grow">🛰 <b>OwnTracks actif</b>
            {state.lastSeenAt ? ' · dernier envoi ' + ago(state.lastSeenAt) : ' · en attente du premier envoi de l’application'}
            {state.battery !== null ? ' · batterie ' + state.battery + ' %' : ''}</span>
          <button onClick={() => void stop()}>Arrêter</button>
        </div>
        <p className="muted">Votre position est envoyée même écran éteint. Reconfigurer sur un autre téléphone désactive celui-ci.
          <button className="link small" onClick={() => void configure()}>Reconfigurer</button></p>
      </div>
    );
  }

  return (
    <div className="card small" data-testid="owntracks">
      {!open && !link ? (
        <div className="row">
          <span className="grow">Suivi même <b>écran éteint</b> : avec l’application gratuite OwnTracks (facultatif).</span>
          <button onClick={() => setOpen(true)}>Configurer</button>
        </div>
      ) : (
        <div className="stack">
          <h3>Suivi écran éteint avec OwnTracks</h3>
          <ol className="steps">
            <li>Installez <b>OwnTracks</b> : <a href="https://play.google.com/store/apps/details?id=org.owntracks.android" target="_blank" rel="noreferrer">Google Play</a>,{' '}
              <a href="https://f-droid.org/packages/org.owntracks.android/" target="_blank" rel="noreferrer">F-Droid</a>, ou sur iPhone l’App Store
              (cherchez « OwnTracks », voir <a href="https://owntracks.org" target="_blank" rel="noreferrer">owntracks.org</a>).</li>
            <li>{link ? 'Touchez le bouton ci-dessous : OwnTracks s’ouvre et se configure seul.' : 'Créez votre lien de configuration personnel.'}</li>
            <li>Dans OwnTracks, autorisez la localisation <b>« Toujours »</b> (et désactivez l’économie de batterie pour l’application).</li>
          </ol>
          {!link ? (
            <button className="big primary" disabled={busy} onClick={() => void configure()}>Créer mon lien de configuration</button>
          ) : (
            <>
              <a className="button big primary" href={link} data-testid="lien-owntracks">Ouvrir OwnTracks avec la configuration</a>
              <p className="warning">Lien <b>personnel</b> (il permet d’envoyer des positions en votre nom) : ne le partagez pas. Il n’est affiché qu’une fois.</p>
              {qr && (
                <details>
                  <summary>Configurer un autre téléphone (QR code)</summary>
                  <img src={qr} alt="QR code de configuration OwnTracks" width={220} height={220} />
                  <p className="muted">Scannez avec l’appareil photo du téléphone sur lequel OwnTracks est installé.</p>
                </details>
              )}
              <button onClick={() => { setLink(null); setOpen(false); }}>C’est fait</button>
            </>
          )}
          <p className="muted">
            Envoi toutes les 30 s environ pendant le suivi (consommation de batterie importante : prévoyez une batterie externe).
            Vos points de mission sont transmis à l’application comme zones : y entrer enregistre votre arrivée. Dernière position
            seulement, visible de l’organisation ; tout s’arrête à la fin de la manifestation. Vous pourrez ensuite désinstaller l’application.
          </p>
        </div>
      )}
    </div>
  );
}
