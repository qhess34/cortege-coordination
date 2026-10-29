export type Position = [number, number];

export interface Me { id: number; login: string; displayName: string; globalRole: 'admin' | 'organisateur' | 'aucun' }

export interface EventInfo {
  id: number; name: string; description: string; startsAt: string | null; endsAt: string | null; areaName: string;
  status: 'preparation' | 'pret' | 'en_cours' | 'termine' | 'archive'; instructions: string; currentTrackId: number | null;
  version: number; role?: 'organisateur' | 'responsable' | 'membre';
}

export interface Track {
  id: number; version: number; name: string | null; filename: string; length: number; closed: boolean; warnings: string[];
  createdAt: string; geometry: { type: 'MultiLineString'; coordinates: Position[][] };
}
export interface Waypoint { id: number; name: string | null; position: Position; distance: number | null }

export interface Branch { wayId: number; name: string | null; highway: string; flow: string; motor: string; crossing: boolean; tags: Record<string, string> }
export interface Suggestion {
  id: number; stableKey: string; type: string; pertinence: 'elevee' | 'moyenne' | 'faible'; status: 'a_examiner' | 'validee' | 'ecartee';
  position: Position; distance: number | null; passages: number[]; routeNames: string[]; branches: Branch[];
  restrictions: { relationId: number; restriction: string }[]; nodeIds: number[]; reasons: string[]; uncertainties: string[];
  pendingUpdate: unknown; dismissedReason: string | null; pointId: number | null; teams: { id: number; name: string; color: string }[];
}

export interface PointMission { missionId: number; teamId: number; teamName: string; color: string; position: number; status: string }
export interface MissionPoint {
  id: number; origin: 'suggestion' | 'manuel' | 'import'; suggestionId: number | null; name: string; description: string; type: string;
  position: Position; distance: number | null; distanceLocked: boolean; status: string; missions: PointMission[]; version: number;
}

export interface TeamMission {
  id: number; position: number; status: string; version: number; instructions: string; pointId: number; pointName: string;
  distance: number | null; pointDeleted: boolean;
}
export interface Team {
  id: number; name: string; color: string; description: string; instructions: string; leaderUserId: number | null;
  leaderName: string | null; status: string; disabled: boolean; version: number; missions: TeamMission[];
}

export interface Summary {
  suggestions: Record<string, number>; points: Record<string, number>; teams: { active: number; total: number };
  missions: Record<string, number>; unassignedPoints: { id: number; name: string; distance: number | null }[];
  track: { id: number; version: number; length: number; closed: boolean; warnings: string[] } | null;
  lastAnalysis: { id: number; at: string; osmTimestamp: string | null; outdated: boolean } | null;
}

export interface HistoryEntry { id: number; at: string; entity: string; entityId: number | null; action: string; details: unknown; actor: string | null }
