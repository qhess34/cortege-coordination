# Coordination de cortège — contexte de travail

Application web de préparation du parcours d'une manifestation et de coordination des équipes d'encadrement le jour J.
Dépôt : `qhess34/cortege-coordination`. C'est le **seul** projet de cette session de travail : ne pas modifier d'autres
dépôts présents dans l'environnement.

À lire d'abord : [AGENTS.md](AGENTS.md) (règles impératives) et les skills `.claude/skills/` (`architecture`,
`nouvelle-fonctionnalite`, `verifier`, `tests-e2e`, `jour-j`). Conception : [docs/CONCEPTION.md](docs/CONCEPTION.md).
Guides utilisateurs : [docs/guide-organisateur.md](docs/guide-organisateur.md), [docs/guide-membre.md](docs/guide-membre.md).

## Façon de travailler avec l'utilisateur

- Demandes et réponses en **français** ; textes de l'interface et commentaires en français.
- Chaque demande : implémenter, tester (typecheck, tests serveur et web, e2e après `npm run build -w web`), mettre à jour
  guides + README (+ CONCEPTION si le modèle change), commit en français, push sur la branche de travail. Pas de PR sans
  demande explicite.
- Dès que l'instance de l'utilisateur tourne, sa base est **existante** : toute évolution du schéma passe par une
  nouvelle migration `server/migrations/002_*.sql`, `003_*.sql`… (jamais en modifiant une migration appliquée), sauf
  s'il demande explicitement de repartir de zéro.
- Le bac à sable n'a accès ni aux tuiles de carte ni à Overpass ni à Docker Hub : fond gris dans les captures, pas de
  `docker build` complet possible ici.

## État actuel (octobre 2026)

Migrations : un seul fichier, `001_initial.sql` (schéma complet : comptes avec téléphone, carrefours, SOS à types
configurables…). Les migrations 002 à 004 y ont été regroupées le 31/10/2026, l'utilisateur repartant d'une instance
neuve ; plus aucune trace des anciens modèles (incidents, statut de mission « incident »).

**Préparation** : GPX, analyse OSM non destructive (un point par accès ou par carrefour), points nommés d'après la rue
ou le croisement, équipes (points fixes, volante, ouverture, fermeture), missions ordonnées, roadbook imprimable,
**carrefours** (accès regroupés automatiquement à la validation, regroupement manuel proposé sous 50 m dans la bulle du
point, Séparer / Renommer), **GPX** par équipe ou complet, **un POI par carrefour** par défaut (`?regroupement=acces`
pour un POI par point), remise de toutes les missions à « Affectée ».

**Comptes** : créés par un administrateur ; membres d'équipe sans mot de passe (lien d'activation, lien par e-mail,
QR « Connecter un appareil »), profil prénom / nom / e-mail / **téléphone**, expiration et suppression automatique.
Responsables nommés par l'organisation (boutons *Nommer responsable* / *Ajouter comme responsable*).

**Jour J — membres (vue terrain)** : la mission à traiter en premier (statut, consignes, En route / Arrivé / Terminé,
**🆘 SOS**, **🧭 Aller au point suivant**), téléphone du responsable, carte, partage de position et
OwnTracks réduits à une ligne, **points restants** avec leur distance depuis le point en cours, GPX de l'équipe.
Le bouton **SOS** ouvre une fenêtre : choix du **type** (liste configurable par l'organisation, 4 types par défaut :
renforts, secours, agression, problème / blocage) et message facultatif.
Plus d'itinéraire piéton ni de « Ma position » (service et `ROUTING_URL` retirés).
Équipe volante : SOS et relèves en tête d'écran avec **🧭 Rejoindre le lieu**, vibration à chaque nouvelle demande.
Bouton « 📍 La tête est ici » pour tout membre dont la position est connue (sauf la fermeture).

**Jour J — organisation** : onglet *Direct* = compteurs (SOS ouverts, tête, queue, points à lever), **prochains points
devant la tête** groupés par carrefour avec leur état (🆘 SOS, relève, équipe en position, personne,
« x/y accès tenus »), **statut de chaque équipe** avec raccourcis 📞 / 💬 SMS / ✉ message vers le responsable. Le bloc
« Progression du cortège » et les compteurs En position / En route ont été retirés. **SOS affichés sur
les cartes** (planification et coordination en direct), clignotants tant que non résolus. Onglet *Équipes* : éditeur
des types de SOS de la manifestation.

**Automatismes** : progression tête/queue calculée depuis les positions partagées de l'ouverture et de la fermeture ;
arrivée automatique au point le plus proche encore à tenir (30 m ou zone OwnTracks) — une équipe tient plusieurs points
à la fois, le compteur « en position » progresse ; un SOS sans position prend celle du point de la mission concernée.

**Déploiement (`docker-compose.yml`)** : hôte/port de l'app réglables par `APP_HOST` / `APP_PORT` (`.env`) ; service
`backup` = `pg_dump` quotidien (`crond`) vers `BACKUP_PATH`, planning `BACKUP_CRON`, purge au-delà de
`BACKUP_KEEP_DAYS` ; variables documentées dans `.env.example`.

## Pistes non faites

Notifications push (téléphone verrouillé), mode hors ligne, saisie de secours de la progression par l'organisation,
vidéo de présentation (script Playwright + ffmpeg, à lancer hors bac à sable pour avoir les cartes).
