// Affichage des guides (docs/*.md) : sous-ensemble de Markdown (titres, paragraphes, listes, cases à cocher,
// citations, tableaux, gras, italique, code, liens). Produit des éléments React : aucun HTML n'est injecté.
import { Fragment, type ReactNode } from 'react';

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: { text: string; checked: boolean | null; children: string[] }[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

/** Identifiant d'ancre d'un titre (« Les équipes » → « les-equipes »). */
export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ kind: 'h', level: h[1]!.length, text: h[2]! }); i++; continue; }
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) buf.push(lines[i++]!.replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    const item = /^(\d+\.|-)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = item[1] !== '-';
      const items: { text: string; checked: boolean | null; children: string[] }[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = /^(\d+\.|-)\s+(.*)$/.exec(l);
        if (m && (m[1] !== '-') === ordered) {
          const box = /^\[( |x)\]\s+(.*)$/.exec(m[2]!);
          items.push({ text: box ? box[2]! : m[2]!, checked: box ? box[1] === 'x' : null, children: [] });
          i++;
        } else if (/^\s{2,}-\s+/.test(l) && items.length) {
          items[items.length - 1]!.children.push(l.replace(/^\s+-\s+/, ''));
          i++;
        } else if (/^\s{2,}\S/.test(l) && items.length) {
          // Suite du texte de l'élément (ou du dernier sous-élément).
          const last = items[items.length - 1]!;
          if (last.children.length) last.children[last.children.length - 1] += ' ' + l.trim();
          else last.text += ' ' + l.trim();
          i++;
        } else if (!l.trim() && /^\s{2,}\S/.test(lines[i + 1] ?? '') && items.length) {
          i++; // paragraphe rattaché à l'élément précédent
        } else break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|>|\d+\.\s|-\s|\|)/.test(lines[i]!)) buf.push(lines[i++]!.trim());
    blocks.push({ kind: 'p', text: buf.join(' ') });
  }
  return blocks;
}

/** Mise en forme dans une ligne : **gras**, *italique*, `code`, [lien](url). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++}>{inline(m[1])}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k++}>{inline(m[2])}</em>);
    else if (m[3] !== undefined) out.push(<code key={k++}>{m[3]}</code>);
    else {
      const href = m[5]!;
      // Seuls les liens web et les ancres internes sont rendus cliquables.
      const safe = /^(https?:\/\/|#)/.test(href);
      out.push(safe ? <a key={k++} href={href} {...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noreferrer' })}>{m[4]}</a> : <Fragment key={k++}>{m[4]}</Fragment>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, toc = false }: { source: string; toc?: boolean }) {
  const blocks = parse(source);
  const sections = blocks.filter((b): b is Extract<Block, { kind: 'h' }> => b.kind === 'h' && b.level === 2);
  return (
    <div className="markdown">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h': {
            const Tag = (['h1', 'h2', 'h3', 'h4'] as const)[b.level - 1]!;
            return (
              <Fragment key={i}>
                <Tag id={slug(b.text)}>{inline(b.text)}</Tag>
                {toc && b.level === 1 && sections.length > 2 && (
                  <nav className="toc" aria-label="Sommaire">
                    {(() => {
                      const items = sections.map((s) => <li key={s.text}><a href={'#' + slug(s.text)} onClick={(e) => { e.preventDefault(); document.getElementById(slug(s.text))?.scrollIntoView({ behavior: 'smooth' }); }}>{s.text}</a></li>);
                      // Titres déjà numérotés (« 1. … ») : pas de seconde numérotation.
                      return sections.every((x) => /^\d+\./.test(x.text)) ? <ul className="plain">{items}</ul> : <ol>{items}</ol>;
                    })()}
                  </nav>
                )}
              </Fragment>
            );
          }
          case 'p': return <p key={i}>{inline(b.text)}</p>;
          case 'quote': return <blockquote key={i}>{inline(b.text)}</blockquote>;
          case 'table':
            return (
              <table key={i} className="table">
                <thead><tr>{b.head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} className={b.items.some((x) => x.checked !== null) ? 'checklist' : undefined}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    {it.checked !== null && <input type="checkbox" defaultChecked={it.checked} aria-label={it.text} />} {inline(it.text)}
                    {it.children.length > 0 && <ul>{it.children.map((c, n) => <li key={n}>{inline(c)}</li>)}</ul>}
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
