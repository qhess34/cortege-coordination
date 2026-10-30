---
name: jour-j
description: Règles métier du jour J (statuts de mission, types d'équipe, incidents et SOS, progression tête/queue, positions partagées et OwnTracks, carrefours) à respecter quand on touche à la vue terrain ou à la coordination.
---

# Règles métier du jour J

## Missions

- Statuts : `a_preparer` → `affectee` → `en_deplacement` → `en_position` → `terminee`, plus `releve_necessaire` et
  `incident`. Transitions de l'organisation : `TRANSITIONS` (`routes/teams.ts`) ; un membre ne peut qu'avancer
  (`MEMBER_TRANSITIONS`, `routes/terrain.ts`). Terminer une mission ne libère pas le point.
- Remise de toutes les missions (ou d'une équipe) à « Affectée » : `POST /api/events/:id/missions/reinitialiser`.

## Équipes

- `points` : tiennent leurs points ; `volante` : voit tous les incidents, les SOS et les relèves avec un lien GPS
  (alerte + vibration à chaque nouvelle demande) ; `ouverture` : porte la tête ; `fermeture` : porte la queue
  (points dépassés « à lever »).
- Responsables : nommés par l'organisation seulement ; leur téléphone est visible des membres de l'équipe.

## Incidents

- `aide`, `sante`, `securite` sont prioritaires. Lieu : position jointe, sinon le point de la mission
  (`positionSource` : `signalee` | `point`).
- **Pas de double saisie** : même nature, encore ouvert, même mission ou à moins de 30 m → l'incident existant est
  complété (`duplicate: true`).
- Rappel toujours affiché : un signalement ne prévient pas les secours (15, 17, 18, 112).

## Progression du cortège

- Automatique depuis les positions partagées de l'ouverture (tête = le plus avancé) et de la fermeture (queue = le plus
  en arrière) : positions < 10 min, précision ≤ 100 m, à moins de 150 m du parcours, une mise à jour par minute au plus,
  sans auteur ni coordonnées (`autoProgress`, `services/locations.ts`).
- Déclaration manuelle depuis la vue terrain (ouverture/responsables pour la tête, fermeture pour la queue) ; tout
  membre dont la position est connue a un simple bouton « la tête est ici ». Toujours présentée comme indicative.

## Positions (vie privée)

- Double accord : l'organisation autorise (`events.location_sharing`), puis chaque membre choisit. Dernière position
  seulement, jamais d'historique ni d'audit, purgée après 2 h, à l'arrêt ou au retrait de l'équipe ; visible de
  l'organisation seulement.
- Arrivée automatique à moins de 30 m du point (précision ≤ 50 m) ou entrée dans la zone OwnTracks.
- OwnTracks : secret haché, lien affiché une fois, mis au repos à la fin de la manifestation.

## Carrefours

Les accès d'un même carrefour sont regroupés (`places`) : automatiquement à la validation des suggestions, à la main
depuis la bulle (proposé sous 50 m, jamais d'office). Chaque accès reste un point de mission ; le carrefour sert au
GPX (un POI par carrefour, `?regroupement=acces` pour un POI par point) et au suivi (`placeGroups` : état le plus grave,
« x/y accès tenus »).
