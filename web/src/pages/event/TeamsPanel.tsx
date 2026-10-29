import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { MISSION_STATUS, MISSION_TRANSITIONS, TEAM_KIND, TEAM_KIND_SHORT, km } from '../../labels';
import { TeamAccess } from '../../components/TeamAccess';
import type { Team } from '../../types';
import type { PanelProps } from '../EventPage';

const PALETTE = ['#e63946', '#1d3557', '#2a9d8f', '#f4a261', '#6a4c93', '#ff006e', '#3a86ff', '#8ac926'];
interface Member { id: number; displayName: string; role: string }

export function TeamsPanel(props: PanelProps) {
  const { data, canEdit, run } = props;
  const [name, setName] = useState('');
  const [kind, setKind] = useState('points');
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { void api.get<Member[]>('/api/events/' + data.event.id + '/members').then(setMembers); }, [data.event.id]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const color = PALETTE[data.teams.length % PALETTE.length];
    if (await run(() => api.post('/api/events/' + data.event.id + '/teams', { name, color, kind }), 'Équipe créée.')) setName('');
  };

  return (
    <div className="stack">
      <div className="row">
        <a className="button" href={'#/evenements/' + data.event.id + '/roadbook'}>📄 Roadbook complet</a>
        <a className="button" href={'/api/events/' + data.event.id + '/roadbook.gpx'} download>GPX de tous les points</a>
      </div>
      {canEdit && (
        <form className="row" onSubmit={create}>
          <input placeholder="Nom de la nouvelle équipe" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type d’équipe">
            {Object.entries(TEAM_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="primary">Créer</button>
        </form>
      )}
      {data.teams.length === 0 && <p className="muted">Aucune équipe.</p>}
      {data.teams.map((t) => <TeamCard key={t.id + ':' + t.version + ':' + t.missions.map((m) => m.id + '-' + m.version).join()} team={t} members={members} {...props} />)}
    </div>
  );
}

function TeamCard({ team: t, members, data, canEdit, run, select, reload }: PanelProps & { team: Team; members: Member[] }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: t.name, color: t.color, description: t.description, instructions: t.instructions, leaderUserId: t.leaderUserId, leaderCanInvite: t.leaderCanInvite, kind: t.kind });
  const [toAdd, setToAdd] = useState('');
  const [access, setAccess] = useState(false);
  // Le serveur reste seul juge : un responsable n'a accès à cette section que si l'organisateur l'a permis.
  const canManage = canEdit || (data.event.role === 'responsable' && t.leaderCanInvite);
  const others = data.teams.filter((x) => x.id !== t.id && !x.disabled);
  const inTeam = new Set(t.missions.map((m) => m.pointId));
  // Points proposés à l'affectation : d'abord ceux qui n'ont aucune équipe.
  const candidates = data.points
    .filter((p) => !inTeam.has(p.id))
    .sort((a, b) => a.missions.length - b.missions.length || (a.distance ?? 0) - (b.distance ?? 0));

  const move = (i: number, d: number) => {
    const ids = t.missions.map((m) => m.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api.put('/api/teams/' + t.id + '/missions/order', { missionIds: ids }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.patch('/api/teams/' + t.id, { ...form, version: t.version }), 'Équipe enregistrée.')) setEditing(false);
  };

  return (
    <div className={'card team' + (t.disabled ? ' disabled' : '')} style={{ borderLeftColor: t.color }}>
      <div className="row">
        <h3 className="grow">{t.name} {t.kind !== 'points' && <span className="badge" title={TEAM_KIND[t.kind]}>{TEAM_KIND_SHORT[t.kind]}</span>} {t.disabled && <span className="badge">désactivée</span>}</h3>
        {!t.disabled && <a className="button" href={'#/evenements/' + data.event.id + '/roadbook/equipe/' + t.id} aria-label={'Roadbook de l’équipe ' + t.name}>📄 Roadbook</a>}
        {canEdit && <button onClick={() => setEditing(!editing)}>{editing ? 'Fermer' : 'Modifier'}</button>}
      </div>
      <p className="muted">
        Responsable : {t.leaderName ?? 'non désigné'} · {t.members} membre(s){t.description ? ' · ' + t.description : ''}
        {t.pendingAdmissions > 0 && <span className="badge warn"> {t.pendingAdmissions} demande(s) à valider</span>}
      </p>
      {canManage && !t.disabled && (
        <button className="link" onClick={() => setAccess(!access)} aria-expanded={access}>
          {access ? '▾' : '▸'} Membres et invitations
        </button>
      )}
      {access && canManage && !t.disabled && (
        <TeamAccess team={t} eventName={data.event.name} organizer={canEdit} accounts={members} onChanged={reload} />
      )}
      {editing && (
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
          <label>Responsable
            <select value={form.leaderUserId ?? ''} onChange={(e) => setForm({ ...form, leaderUserId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— aucun —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.role})</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={form.leaderCanInvite} onChange={(e) => setForm({ ...form, leaderCanInvite: e.target.checked })} />
            Les responsables de l’équipe peuvent inviter et valider des membres</label>
          <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Consignes de l’équipe<textarea rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
          <div className="row">
            <button className="primary">Enregistrer</button>
            <button type="button" className={t.disabled ? '' : 'danger'} onClick={() => run(() => api.post('/api/teams/' + t.id + '/disable', { disabled: !t.disabled }), t.disabled ? 'Équipe réactivée.' : 'Équipe désactivée.')}>
              {t.disabled ? 'Réactiver' : 'Désactiver'}
            </button>
          </div>
        </form>
      )}
      <ol className="missions">
        {t.missions.map((m, i) => (
          <li key={m.id}>
            <div className="row">
              <button className="link grow" onClick={() => select({ kind: 'point', id: m.pointId })}>{m.pointName}</button>
              <span className="muted">{km(m.distance)}</span>
            </div>
            {canEdit && (
              <div className="row small">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === t.missions.length - 1} aria-label="Descendre">↓</button>
                <select value="" onChange={(e) => e.target.value && run(() => api.post('/api/missions/' + m.id + '/status', { status: e.target.value, version: m.version }), 'Statut mis à jour.')} aria-label="Statut">
                  <option value="">{MISSION_STATUS[m.status]}</option>
                  {(MISSION_TRANSITIONS[m.status] ?? []).map((s) => <option key={s} value={s}>→ {MISSION_STATUS[s]}</option>)}
                </select>
                {others.length > 0 && (
                  <select value="" onChange={(e) => e.target.value && run(() => api.post('/api/missions/' + m.id + '/reassign', { teamId: Number(e.target.value), version: m.version }), 'Mission réaffectée.')} aria-label="Réaffecter">
                    <option value="">Réaffecter…</option>
                    {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                <button onClick={() => run(() => api.delete('/api/missions/' + m.id), 'Point retiré de l’équipe.')} aria-label="Retirer">✕</button>
              </div>
            )}
            {!canEdit && <span className="muted">{MISSION_STATUS[m.status]}</span>}
          </li>
        ))}
      </ol>
      {t.missions.length === 0 && <p className="muted">Aucune mission.</p>}
      {canEdit && !t.disabled && candidates.length > 0 && (
        <div className="row">
          <select className="grow" value={toAdd} onChange={(e) => setToAdd(e.target.value)} aria-label="Point à affecter">
            <option value="">Affecter un point…</option>
            {candidates.map((p) => <option key={p.id} value={p.id}>{p.missions.length ? '' : '● '}{p.name} ({km(p.distance)})</option>)}
          </select>
          <button disabled={!toAdd} onClick={async () => { if (await run(() => api.post('/api/teams/' + t.id + '/missions', { pointId: Number(toAdd) }), 'Point affecté.')) setToAdd(''); }}>Affecter</button>
        </div>
      )}
    </div>
  );
}
