import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import guideMembre from '../../../docs/guide-membre.md?raw';
import guideOrganisateur from '../../../docs/guide-organisateur.md?raw';
import { Markdown, slug } from './Markdown';

const html = (md: string, toc = false) => renderToStaticMarkup(<Markdown source={md} toc={toc} />);

describe('Markdown des guides', () => {
  it('titres, listes imbriquées, cases, citations, tableaux, mise en forme', () => {
    const out = html([
      '# Titre', '', 'Un **gras**, un *italique*, du `code` et [un lien](https://exemple.org).', '',
      '> Attention : à vérifier', '> sur le terrain.', '',
      '1. Premier', '2. Second', '   - sous-point', '     suite', '',
      '- [ ] À faire', '- [x] Fait', '',
      '| Type | Rôle |', '|---|---|', '| **Volante** | Incidents |',
    ].join('\n'));
    expect(out).toContain('<h1 id="titre">Titre</h1>');
    expect(out).toContain('<strong>gras</strong>');
    expect(out).toContain('<em>italique</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<a href="https://exemple.org" target="_blank" rel="noreferrer">un lien</a>');
    expect(out).toContain('<blockquote>Attention : à vérifier sur le terrain.</blockquote>');
    expect(out).toMatch(/<ol><li> ?Premier<\/li><li> ?Second<ul><li>sous-point suite<\/li><\/ul><\/li><\/ol>/);
    expect(out).toContain('class="checklist"');
    expect(out).toContain('<td><strong>Volante</strong></td>');
  });

  it('n’injecte jamais de HTML ni de lien javascript:', () => {
    const out = html('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('javascript:');
  });

  it('les deux guides se lisent en entier, avec un sommaire', () => {
    for (const g of [guideOrganisateur, guideMembre]) {
      const out = html(g, true);
      expect(out).toContain('<nav class="toc"');
      expect(out).not.toContain('**');
      expect(out.match(/<h2/g)!.length).toBeGreaterThan(4);
    }
    expect(slug('Le jour J : onglet Coordination')).toBe('le-jour-j-onglet-coordination');
  });
});
