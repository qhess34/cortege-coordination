// « Connecter un appareil » : QR code de connexion (10 minutes, usage unique) à scanner avec son téléphone.
import QRCode from 'qrcode';
import { useState } from 'react';
import { ApiError, api } from '../api';

export function ConnectDevice() {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setOpen(true);
    setError(null);
    try {
      const l = await api.post<{ url: string; expiresAt: string }>('/api/auth/liens');
      setLink(l);
      setQr(await QRCode.toDataURL(l.url, { margin: 1, width: 320, errorCorrectionLevel: 'M' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lien indisponible.');
    }
  };
  const close = () => { setOpen(false); setLink(null); setQr(null); };
  return (
    <>
      <button className="link" onClick={() => void start()}>📱 Connecter un appareil</button>
      {open && (
        <div className="modal-backdrop" onClick={close}>
          <div className="card modal stack" role="dialog" aria-label="Connecter un appareil" onClick={(e) => e.stopPropagation()}>
            <h2>Connecter un appareil</h2>
            <p>Scannez ce QR code avec l’appareil photo de votre téléphone : il sera connecté à votre compte, sans mot de passe.</p>
            {qr && <img src={qr} alt="QR code de connexion" width={240} height={240} className="qr" data-testid="qr-connexion" />}
            {link && (
              <p className="muted small">
                Valable jusqu’à {new Date(link.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, une seule fois.
                Ne le montrez à personne d’autre : il donne accès à votre compte.
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <button onClick={close}>Fermer</button>
          </div>
        </div>
      )}
    </>
  );
}
