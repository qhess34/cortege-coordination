// Légende des équipes sur la carte : couleur, nombre de points, et affichage ou masquage par équipe.
import { useState } from 'react';
import type { MissionPoint, Team } from '../types';

export const NO_TEAM = 0;

interface Props {
  teams: Team[];
  points: MissionPoint[];
  hidden: Set<number>;
  onToggle: (teamId: number) => void;
}

export function TeamLegend({ teams, points, hidden, onToggle }: Props) {
  const [open, setOpen] = useState(true);
  const active = teams.filter((t) => !t.disabled);
  if (!active.length) return null;
  const count = (id: number) => points.filter((p) => (id === NO_TEAM ? p.missions.length === 0 : p.missions.some((m) => m.teamId === id))).length;
  return (
    <div className="team-legend" data-testid="legende-equipes">
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>Équipes {open ? '▾' : '▸'}</button>
      {open && (
        <ul className="plain">
          {active.map((t) => (
            <li key={t.id}>
              <label className="check">
                <input type="checkbox" checked={!hidden.has(t.id)} onChange={() => onToggle(t.id)} />
                <span className="dot" style={{ background: t.color }} /> {t.name} <span className="muted">({count(t.id)})</span>
              </label>
            </li>
          ))}
          <li>
            <label className="check">
              <input type="checkbox" checked={!hidden.has(NO_TEAM)} onChange={() => onToggle(NO_TEAM)} />
              <span className="dot" style={{ background: '#495057' }} /> Sans équipe <span className="muted">({count(NO_TEAM)})</span>
            </label>
          </li>
        </ul>
      )}
    </div>
  );
}

/** Points visibles selon les équipes masquées (un point de plusieurs équipes reste visible si l'une l'est). */
export function visiblePoints(points: MissionPoint[], hidden: Set<number>): MissionPoint[] {
  if (!hidden.size) return points;
  return points.filter((p) => (p.missions.length === 0 ? !hidden.has(NO_TEAM) : p.missions.some((m) => !hidden.has(m.teamId))));
}
