// Onglet Équipes : répartir les points entre les équipes, puis gérer chaque équipe (points, membres, réglages).
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { TeamAccess } from '../../components/TeamAccess';
import { MISSION_STATUS, MISSION_TRANSITIONS, TEAM_KIND, TEAM_KIND_SHORT, km } from '../../labels';
import type { MissionPoint, Team, TeamMission } from '../../types';
import type { PanelProps } from '../EventPage';

const PALETTE = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#6a4c93', '#ff006e', '#3a86ff', '#8ac926'];
/** Ordre du cortège : ouverture en tête, équipes à points fixes, volantes, fermeture en queue. */
const KIND_ORDER: Record<string, number> = { ouverture: 0, points: 1, volante: 2, fermeture: 3 };
const PREF = 'cortege.equipes.ouvertes';
interface Member { id: number; displayName: string; role: string }

const readOpen = (): number[] => { try { return JSON.parse(localStorage.getItem(PREF) ?? '[]') as number[]; } catch { return []; } };

export function TeamsPanel(props: PanelProps) {
  const { data, canEdit, run } = props;
  const [members, setMembers] = useState<Member[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set(readOpen()));
  const [allFree, setAllFree] = useState(false);
  useEffect(() => { void api.get<Member[]>('/api/events/' + data.event.id + '/members').then(setMembers); }, [data.event.id]);

  const toggle = (id: number, value?: boolean) => setOpen((prev) => {
    const next = new Set(prev);
    if (value ?? !next.has(id)) next.add(id); else next.delete(id);
    try { localStorage.setItem(PREF, JSON.stringify([...next])); } catch { /* préférence non mémorisée */ }
    return next;
  });

  const teams = [...data.teams].sort((a, b) =>
    Number(a.disabled) - Number(b.disabled) || (KIND_ORDER[a.kind] ?? 1) - (KIND_ORDER[b.kind] ?? 1) || a.name.localeCompare(b.name, 'fr'));
  const active = teams.filter((t) => !t.disabled);
  const unassigned = data.points.filter((p) => p.missions.length === 0).sort(byDistance);
  const assigned = data.points.length - unassigned.length;

  return (
    <div className="stack teams-panel">
      <div className="teams-summary row">
        <span className="grow">
          <b>{active.length}</b> équipe(s) · <b>{assigned}/{data.points.length}</b> point(s) affecté(s)
        </span>
        {canEdit && !creating && <button className="primary" onClick={() => setCreating(true)}>+ Nouvelle équipe</button>}
      </div>

      {creating && <NewTeam {...props} onDone={(id) => { setCreating(false); if (id) toggle(id, true); }} />}

      {canEdit && unassigned.length > 0 && active.length > 0 && (
        <div className="card unassigned" data-testid="points-sans-equipe">
          <h3>Points sans équipe ({unassigned.length})</h3>
          <ul className="plain">
            {(allFree ? unassigned : unassigned.slice(0, 6)).map((p) => (
              <li key={p.id} className="row">
                <button className="link grow" onClick={() => props.select({ kind: 'point', id: p.id })}>{p.name}</button>
                <span className="muted small">{km(p.distance)}</span>
                <select value="" aria-label={'Affecter « ' + p.name + ' » à une équipe'}
                  onChange={(e) => e.target.value && run(() => api.post('/api/teams/' + e.target.value + '/missions', { pointId: p.id }), 'Point affecté.')}>
                  <option value="">Affecter à…</option>
                  {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
          {unassigned.length > 6 && (
            <button className="link small" onClick={() => setAllFree(!allFree)}>{allFree ? 'Réduire' : 'Voir les ' + (unassigned.length - 6) + ' autres'}</button>
          )}
        </div>
      )}
      {canEdit && data.points.length > 0 && unassigned.length === 0 && <p className="muted small">✓ Tous les points ont une équipe.</p>}

      {teams.length === 0 && <p className="muted">Aucune équipe. Créez-en une, puis affectez-lui des points.</p>}
      <div className="team-list">
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} members={members} expanded={open.has(t.id)} onToggle={() => toggle(t.id)} {...props} />
        ))}
      </div>

      <div className="row small exports">
        <span className="muted">Exports :</span>
        <a href={'#/evenements/' + data.event.id + '/roadbook'}>📄 Roadbook complet</a>
        <a href={'/api/events/' + data.event.id + '/roadbook.gpx'} download>GPX de tous les points</a>
      </div>
    </div>
  );
}

const byDistance = (a: MissionPoint, b: MissionPoint) => (a.distance ?? 0) - (b.distance ?? 0);

function NewTeam({ data, run, onDone }: PanelProps & { onDone: (id: number | null) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('points');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const color = PALETTE[data.teams.length % PALETTE.length];
    let id: number | null = null;
    const ok = await run(async () => { id = (await api.post<Team>('/api/events/' + data.event.id + '/teams', { name, color, kind })).id; }, 'Équipe créée.');
    if (ok) onDone(id);
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Nouvelle équipe</h3>
      <input placeholder="Nom de la nouvelle équipe" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      <div className="kind-choice" role="radiogroup" aria-label="Type d’équipe">
        {Object.entries(TEAM_KIND).map(([k, v]) => (
          <label key={k} className={'check' + (kind === k ? ' selected' : '')}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {v}
          </label>
        ))}
      </div>
      <div className="row">
        <button className="primary">Créer</button>
        <button type="button" onClick={() => onDone(null)}>Annuler</button>
      </div>
    </form>
  );
}

type Section = 'points' | 'membres' | 'reglages';

function TeamCard(props: PanelProps & { team: Team; members: Member[]; expanded: boolean; onToggle: () => void }) {
  const { team: t, data, canEdit, expanded, onToggle } = props;
  // Le serveur reste seul juge : un responsable n'a accès aux membres que si l'organisateur l'a permis.
  const canManage = canEdit || (data.event.role === 'responsable' && t.leaderCanManage);
  const [section, setSection] = useState<Section>('points');
  const held = t.missions.filter((m) => m.status === 'en_position').length;
  const alerts = [
    !t.disabled && t.kind === 'points' && t.missions.length === 0 && 'aucun point',
    !t.disabled && t.members === 0 && !t.leaderName && 'aucun membre',
  ].filter(Boolean) as string[];

  return (
    <section className={'card team' + (t.disabled ? ' disabled' : '') + (expanded ? ' open' : '')} style={{ borderLeftColor: t.color }} data-testid={'equipe-' + t.id}>
      <button className="team-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
        <span className="grow">
          <h3>{t.name}{t.kind !== 'points' && <span className="badge" title={TEAM_KIND[t.kind]}>{TEAM_KIND_SHORT[t.kind]}</span>}{t.disabled && <span className="badge">désactivée</span>}</h3>
          <span className="muted small">
            {t.kind === 'points' || t.missions.length ? t.missions.length + ' point(s)' + (held ? ' · ' + held + ' en position' : '') + ' · ' : ''}
            {t.members} membre(s){t.leaderName ? ' · resp. ' + t.leaderName : ''}
          </span>
        </span>
        {alerts.map((a) => <span key={a} className="badge warn">{a}</span>)}
      </button>

      {expanded && (
        <div className="team-body">
          <nav className="segmented" role="tablist" aria-label={'Équipe ' + t.name}>
            <button role="tab" aria-selected={section === 'points'} onClick={() => setSection('points')}>Points ({t.missions.length})</button>
            {canManage && !t.disabled && (
              <button role="tab" aria-selected={section === 'membres'} onClick={() => setSection('membres')} title="Membres de l’équipe">Membres ({t.members})</button>
            )}
            {canEdit && <button role="tab" aria-selected={section === 'reglages'} onClick={() => setSection('reglages')}>Réglages</button>}
          </nav>
          {section === 'points' && <TeamPoints {...props} />}
          {section === 'membres' && canManage && !t.disabled && (
            <TeamAccess teamId={t.id} organizer={canEdit} onChanged={props.reload} />
          )}
          {section === 'reglages' && canEdit && <TeamSettings {...props} />}
        </div>
      )}
    </section>
  );
}

function TeamPoints({ team: t, data, canEdit, run, select }: PanelProps & { team: Team }) {
  const [menu, setMenu] = useState<number | null>(null);
  const inTeam = new Set(t.missions.map((m) => m.pointId));
  const free = data.points.filter((p) => !inTeam.has(p.id) && p.missions.length === 0).sort(byDistance);
  const elsewhere = data.points.filter((p) => !inTeam.has(p.id) && p.missions.length > 0).sort(byDistance);

  const move = (i: number, d: number) => {
    const ids = t.missions.map((m) => m.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api.put('/api/teams/' + t.id + '/missions/order', { missionIds: ids }));
  };

  return (
    <div className="stack">
      {t.kind !== 'points' && t.missions.length === 0 && (
        <p className="muted small">{TEAM_KIND[t.kind]} : pas de point fixe nécessaire. Vous pouvez tout de même lui confier des points.</p>
      )}
      {t.missions.length === 0 && t.kind === 'points' && <p className="muted small">Aucun point. Ajoutez-en ci-dessous, ou depuis la bulle d’un point sur la carte.</p>}
      {t.missions.length > 0 && (
        <ol className="team-points">
          {t.missions.map((m, i) => (
            <li key={m.id} className="row">
              <span className="num">{i + 1}</span>
              <button className="link grow" onClick={() => select({ kind: 'point', id: m.pointId })} title="Voir sur la carte">{m.pointName}</button>
              <span className="muted small">{km(m.distance)}</span>
              <span className={'status-badge s-' + m.status}>{MISSION_STATUS[m.status]}</span>
              {canEdit && (
                <span className="row-actions">
                  <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter" title="Monter">↑</button>
                  <button className="icon" onClick={() => move(i, 1)} disabled={i === t.missions.length - 1} aria-label="Descendre" title="Descendre">↓</button>
                  <button className="icon" onClick={() => setMenu(menu === m.id ? null : m.id)} aria-expanded={menu === m.id} aria-label={'Actions pour ' + m.pointName} title="Statut, réaffecter, retirer">⋯</button>
                </span>
              )}
              {menu === m.id && canEdit && <MissionMenu mission={m} team={t} data={data} run={run} onClose={() => setMenu(null)} />}
            </li>
          ))}
        </ol>
      )}
      {canEdit && !t.disabled && (free.length > 0 || elsewhere.length > 0) && (
        <select value="" aria-label="Point à affecter"
          onChange={(e) => e.target.value && run(() => api.post('/api/teams/' + t.id + '/missions', { pointId: Number(e.target.value) }), 'Point affecté.')}>
          <option value="">+ Ajouter un point à {t.name}…</option>
          {free.length > 0 && <optgroup label="Sans équipe">{free.map((p) => <option key={p.id} value={p.id}>{p.name} ({km(p.distance)})</option>)}</optgroup>}
          {elsewhere.length > 0 && (
            <optgroup label="Déjà tenus par une autre équipe (renfort)">
              {elsewhere.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.missions.map((x) => x.teamName).join(', ')}</option>)}
            </optgroup>
          )}
        </select>
      )}
      {!t.disabled && t.missions.length > 0 && (
        <a className="small" href={'#/evenements/' + data.event.id + '/roadbook/equipe/' + t.id} aria-label={'Roadbook de l’équipe ' + t.name}>📄 Roadbook de l’équipe</a>
      )}
    </div>
  );
}

/** Actions secondaires d'une mission : statut, réaffectation, retrait. */
function MissionMenu({ mission: m, team: t, data, run, onClose }: Pick<PanelProps, 'data' | 'run'> & { mission: TeamMission; team: Team; onClose: () => void }) {
  const others = data.teams.filter((x) => x.id !== t.id && !x.disabled);
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) onClose(); };
  return (
    <div className="mission-menu" role="group" aria-label={'Actions pour ' + m.pointName}>
      <label>Statut
        <select value="" onChange={(e) => e.target.value && act(() => api.post('/api/missions/' + m.id + '/status', { status: e.target.value, version: m.version }), 'Statut mis à jour.')} aria-label="Statut">
          <option value="">{MISSION_STATUS[m.status]}</option>
          {(MISSION_TRANSITIONS[m.status] ?? []).map((s) => <option key={s} value={s}>→ {MISSION_STATUS[s]}</option>)}
        </select>
      </label>
      {others.length > 0 && (
        <label>Confier à
          <select value="" onChange={(e) => e.target.value && act(() => api.post('/api/missions/' + m.id + '/reassign', { teamId: Number(e.target.value), version: m.version }), 'Mission réaffectée.')} aria-label="Réaffecter">
            <option value="">une autre équipe…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      <button className="danger" onClick={() => act(() => api.delete('/api/missions/' + m.id), 'Point retiré de l’équipe.')}>Retirer de l’équipe</button>
    </div>
  );
}

function TeamSettings({ team: t, members, run }: PanelProps & { team: Team; members: Member[] }) {
  const initial = () => ({
    name: t.name, color: t.color, description: t.description, instructions: t.instructions, leaderUserId: t.leaderUserId, leaderCanManage: t.leaderCanManage, kind: t.kind,
  });
  const [form, setForm] = useState(initial);
  // Les valeurs suivent l'équipe si elle est modifiée ailleurs.
  useEffect(() => setForm(initial()), [t.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.patch('/api/teams/' + t.id, { ...form, version: t.version }), 'Équipe enregistrée.');
  };
  return (
    <form className="stack" onSubmit={save}>
      <div className="row">
        <label className="grow">Nom<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Couleur<input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
      </div>
      <label>Type d’équipe
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Team['kind'] })}>
          {Object.entries(TEAM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Responsable (compte)
        <select value={form.leaderUserId ?? ''} onChange={(e) => setForm({ ...form, leaderUserId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">— aucun —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.role})</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={form.leaderCanManage} onChange={(e) => setForm({ ...form, leaderCanManage: e.target.checked })} />
        Les responsables de l’équipe peuvent ajouter et retirer des membres</label>
      <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <label>Consignes de l’équipe<textarea rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
      <div className="row">
        <button className="primary">Enregistrer</button>
        <span className="grow" />
        <button type="button" className={t.disabled ? '' : 'danger'}
          onClick={() => (t.disabled || window.confirm('Désactiver l’équipe « ' + t.name + ' » ? Ses membres ne pourront plus agir sur ses missions.'))
            && run(() => api.post('/api/teams/' + t.id + '/disable', { disabled: !t.disabled }), t.disabled ? 'Équipe réactivée.' : 'Équipe désactivée.')}>
          {t.disabled ? 'Réactiver l’équipe' : 'Désactiver l’équipe'}
        </button>
      </div>
    </form>
  );
}
