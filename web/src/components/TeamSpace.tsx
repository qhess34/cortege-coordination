// Vue d'une équipe telle que la voit un membre : consignes et missions dans l'ordre.
import { MISSION_STATUS, SUGGESTION_TYPES, km } from '../labels';
import type { Position } from '../types';

export interface SpaceEvent { id: number; name: string; startsAt: string | null; endsAt: string | null; instructions: string; status: string }
export interface SpaceTeam { id: number; name: string; color: string; instructions: string; role: string; leaderName: string | null; closed: boolean }
export interface SpaceMission { order: number; status: string; instructions: string; point: { name: string; type: string; description: string; position: Position; distance: number | null } }

export function TeamSpace({ event, team, missions }: { event: SpaceEvent; team: SpaceTeam; missions: SpaceMission[] }) {
  return (
    <>
      {team.leaderName && <p>Responsable : <b>{team.leaderName}</b></p>}
      {team.closed && <p className="warning">Cette équipe est désactivée.</p>}
      {event.instructions && <section className="card"><h2>Consignes générales</h2><p className="pre">{event.instructions}</p></section>}
      {team.instructions && <section className="card"><h2>Consignes de l’équipe</h2><p className="pre">{team.instructions}</p></section>}
      <section className="card">
        <h2>Missions de l’équipe</h2>
        {missions.length === 0 ? <p className="muted">Aucune mission pour l’instant.</p> : (
          <ol className="missions">
            {missions.map((m) => (
              <li key={m.order}>
                <b>{m.point.name}</b> <span className="muted">— {SUGGESTION_TYPES[m.point.type] ?? m.point.type}, {km(m.point.distance)}, {MISSION_STATUS[m.status] ?? m.status}</span>
                {m.instructions && <p className="pre">Consignes : {m.instructions}</p>}
                <p className="small">
                  <a href={'https://www.openstreetmap.org/?mlat=' + m.point.position[1] + '&mlon=' + m.point.position[0] + '#map=18/' + m.point.position[1] + '/' + m.point.position[0]} target="_blank" rel="noreferrer">Voir sur une carte</a>
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
