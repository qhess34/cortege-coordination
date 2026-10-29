// Aide : guide de l'organisation et guide des membres d'équipe (docs/*.md, versionnés avec l'application).
import { useState } from 'react';
import guideMembre from '../../../docs/guide-membre.md?raw';
import guideOrganisateur from '../../../docs/guide-organisateur.md?raw';
import { Markdown } from '../components/Markdown';

export function HelpPage({ memberOnly = false }: { memberOnly?: boolean }) {
  const [tab, setTab] = useState<'orga' | 'membre'>(memberOnly ? 'membre' : 'orga');
  return (
    <main className="page help">
      {memberOnly && <p className="small"><a href="#/">← Retour</a></p>}
      {!memberOnly && <nav className="segmented help-tabs" role="tablist" aria-label="Guides">
        <button role="tab" aria-selected={tab === 'orga'} onClick={() => { setTab('orga'); window.scrollTo(0, 0); document.querySelector('.help')?.scrollTo(0, 0); }}>Organisation</button>
        <button role="tab" aria-selected={tab === 'membre'} onClick={() => { setTab('membre'); window.scrollTo(0, 0); document.querySelector('.help')?.scrollTo(0, 0); }}>Membres d’équipe</button>
      </nav>}
      {tab === 'membre' && !memberOnly && (
        <p className="muted small">Ce guide est aussi accessible aux membres dans leur vue terrain (onglet « Aide »). Vous pouvez l’imprimer pour le distribuer.</p>
      )}
      <article className="card" data-testid={'guide-' + tab}>
        <Markdown key={tab} source={tab === 'orga' ? guideOrganisateur : guideMembre} toc />
      </article>
      <button className="no-print" onClick={() => window.print()}>Imprimer ce guide</button>
    </main>
  );
}
