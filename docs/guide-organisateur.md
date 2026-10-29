# Guide de l'organisation

Ce guide accompagne les personnes qui préparent la manifestation et coordonnent les équipes le jour J.

> Les suggestions issues d'OpenStreetMap sont **à vérifier sur le terrain**. Elles ne garantissent rien en matière de
> sécurité et ne remplacent ni les autorisations ni les décisions des autorités compétentes.

## En bref : préparer une manifestation

1. **Créer la manifestation** et renseigner ses dates (*+ Nouvelle manifestation*).
2. **Importer le parcours** (fichier GPX), onglet *Parcours*.
3. **Lancer l'analyse** des rues qui croisent le parcours, onglet *Suggestions*, puis valider ou écarter chaque suggestion.
4. **Compléter les points** à la main sur la carte si besoin.
5. **Créer les équipes** et leur **répartir les points**, onglet *Équipes*.
6. **Inviter les membres** par QR code ou lien.
7. **Imprimer les roadbooks** et vérifier les points sur place.
8. Le jour J, suivre tout depuis l'onglet **Coordination**.

## Comptes et accès

- Il n'y a **pas d'inscription en ligne**. Les comptes d'organisation sont créés par un administrateur (lien *Comptes*
  dans la barre du haut, réservé aux administrateurs) : identifiant, nom affiché, mot de passe initial, rôle global.
- Pour donner accès à une manifestation à un autre compte : onglet *Synthèse*, bloc **Accès des comptes**. Cherchez la
  personne et choisissez son rôle :
  - **Organisateur** : peut tout modifier ;
  - **Responsable** : consulte la manifestation et gère son équipe si l'organisation le permet ;
  - **Membre** : consulte seulement.
- Les membres d'équipe **n'ont pas besoin de compte** : ils rejoignent leur équipe par QR code ou lien d'invitation
  (voir *Équipes*).

## Manifestations

- Le menu déroulant de la barre du haut permet de **basculer d'une manifestation à l'autre**.
- Onglet *Synthèse* → *Modifier* : nom, dates, zone, statut, **consignes générales** (affichées à tous les membres) et
  réglages du suivi de position.
- La suppression (en bas de la *Synthèse*) est **définitive** : il faut retaper le nom. Elle est impossible tant que la
  manifestation est « en cours ».

## Le parcours

- Onglet *Parcours* → **Importer un fichier GPX**. Un aperçu s'affiche avant l'import (longueur, avertissements).
- **Remplacer le parcours** : les points qui s'éloigneraient du nouveau tracé sont signalés avant confirmation. Pensez
  ensuite à relancer l'analyse.
- Bouton **⤢ Parcours** sur la carte : recentre la vue sur tout le tracé.

## Les suggestions (analyse OpenStreetMap)

- Onglet *Suggestions* → **Lancer l'analyse**. L'application interroge OpenStreetMap par tronçons (l'avancement
  s'affiche). Si les serveurs publics sont surchargés, un message le dit clairement : réessayez quelques minutes plus
  tard.
- Options :
  - **Un point par accès entrant** (recommandé) : un point pour chaque côté d'un carrefour d'où un véhicule peut
    arriver. Décoché, un seul point au centre de chaque carrefour.
  - **Inclure les rues sortantes** : rues à sens unique qui partent du parcours (aucun véhicule ne peut en arriver).
  - **Inclure les accès piétons et cyclables**.
- Chaque suggestion indique pourquoi elle est proposée (voies, sens de circulation, accès). Une rue sans sens indiqué
  est considérée à double sens.
- **Valider** crée un point de mission. Le point est nommé d'après les rues, par exemple « Rue A × Rue B (accès nord) ».
  **Écarter** retire la suggestion et mémorise ce choix : elle ne reviendra pas.
- Vous pouvez **faire glisser une suggestion** sur la carte puis *Valider à cette position*.
- Les boutons *Écarter les … rues sortantes / accès piétons* traitent ces cas en une fois.
- **Relancer l'analyse** n'efface rien : elle ajoute seulement les nouveautés et signale ce qui a changé.

## Les points de mission

- **Ajouter un point** : bouton *+ Ajouter des points* puis clic sur la carte (le mode reste actif pour enchaîner).
  Vous pouvez aussi faire un clic sur la carte puis choisir *📍 Ajouter un point ici*, ou utiliser l'onglet *Points* →
  *+ Placer un point par coordonnées*.
- Le **nom est proposé automatiquement** d'après la rue ou le croisement. Il n'écrase jamais un nom saisi. Le bouton
  **Nom de la rue** renomme un point existant.
- **Modifier** : cliquez sur le point, une bulle s'ouvre (nom, type, description, équipes). **Déplacer** : faites glisser
  le point, puis *Enregistrer* (ou *Annuler*).
- **Photos des lieux** : clic sur la carte → *📷 Voir les photos ici (Panoramax)*. La boussole sur la carte suit la
  direction regardée. La case *Couverture photos* montre les rues photographiées.
- Fonds de carte : plan vectoriel (par défaut), plan OSM, plans IGN, vue satellite (menu en haut de la carte).

## Les équipes

### Types d'équipe

| Type | Rôle |
|---|---|
| **Points fixes** | Tient les points de sa liste, dans l'ordre. |
| **Ouverture** | Marche en tête et déclare la position de la **tête** du cortège. |
| **Volante** | Sans point fixe, intervient sur les **incidents** de toute la manifestation. |
| **Fermeture** | Ferme la marche et déclare la **queue**. Les points dépassés pourront être levés. |

### Créer et répartir

- Onglet *Équipes* → **+ Nouvelle équipe** : nom et type. La couleur est attribuée automatiquement et se modifie dans
  *Réglages*.
- Le bloc **Points sans équipe** liste les points à répartir. *Affecter à…* les confie à une équipe en un geste.
- Les équipes sont rangées dans l'ordre du cortège. Cliquez sur une équipe pour la déplier :
  - **Points** : sa liste dans l'ordre de passage (↑ ↓ pour réordonner). Le menu **⋯** permet de changer le statut, de
    confier le point à une autre équipe ou de le retirer. *+ Ajouter un point* propose d'abord les points sans équipe,
    puis ceux déjà tenus, pour un renfort.
  - **Membres** : invitations et membres (voir ci-dessous).
  - **Réglages** : nom, couleur, type, responsable (compte), consignes de l'équipe, désactivation.
- On peut aussi affecter une équipe depuis la **bulle d'un point** sur la carte. Les points prennent la couleur de leur
  équipe.

### Inviter les membres

Dans la section **Membres** d'une équipe :

- **QR code de l'équipe** : à imprimer ou afficher. Options :
  - admission **immédiate** ou **après validation** ;
  - nombre maximal de personnes, date limite ;
  - suspendre, reprendre, régénérer (l'ancien QR ne marche plus) ou désactiver.

  Il ne donne que le rôle de membre.
- **Liens individuels** : un lien à usage unique (24 h à 30 jours) pour une personne précise. Le lien n'est **affiché
  qu'une fois** : copiez-le aussitôt. Seule l'organisation peut inviter un responsable.
- **Demandes à valider** : *Accepter* ou *Refuser*. Un badge le signale dans la liste des équipes.
- **Membres** : *Retirer* coupe l'accès immédiatement. *Lien de récupération* sert à un membre qui a changé de
  téléphone : l'ancien appareil est déconnecté.
- Réglage d'équipe : **« Les responsables peuvent inviter et valider des membres »**.

> Ne testez pas vos propres QR codes dans le navigateur où vous êtes connecté : l'application le refuse pour ne pas
> remplacer votre session. Utilisez un téléphone ou une fenêtre de navigation privée.

## Roadbooks et exports

- **Roadbook** complet ou par équipe (bas de l'onglet *Équipes*, ou section *Points* d'une équipe). Il contient les
  cartes zoomées de chaque lieu, les consignes et les points regroupés par lieu, et il est prêt à imprimer.
- **GPX de tous les points**, à charger dans une application de navigation.

## Le jour J : onglet Coordination

Tout s'y met à jour **en direct**. L'indicateur **● direct** à côté du nom de la manifestation le confirme ; en cas de
coupure, l'écran se recharge toutes les 30 secondes.

- **Compteurs** : points en position, en route, incidents ouverts, tête et queue du cortège, **points à lever**.
- **Progression du cortège** : la tête et la queue sont déclarées en km parcourus, par l'organisation, l'équipe
  d'ouverture (tête) ou de fermeture (queue). Ce n'est pas un suivi GPS. Chaque membre voit à quelle distance la tête
  se trouve de son point.
- **Incidents** : les prioritaires (aide, santé, sécurité) en premier. *Je m'en occupe* indique à l'équipe que c'est
  pris en charge, *Résolu* clôt l'incident. L'équipe volante peut aussi les prendre en charge.
- **Équipes** : statut de chaque point (qui l'a changé, quand), nombre de membres actifs, badge **à lever** quand la
  queue a dépassé un point encore tenu.
- **Messages** : à toutes les équipes ou à une seule, éventuellement **urgents** (bandeau rouge sur les téléphones).
  « lu 3/5 » indique les accusés de lecture. Les réponses des équipes s'affichent ici.

> L'application ne prévient pas les secours. En cas d'urgence vitale, appelez le 15, le 17, le 18 ou le 112.

## Suivi des positions (facultatif)

- À activer dans *Synthèse* → *Modifier* → **Autoriser le partage de position en direct**. Ensuite, **chaque membre
  choisit** de partager sa position, ou non.
- Les membres qui partagent apparaissent sur la carte, avec la couleur de leur équipe. Le survol indique l'heure, la
  précision et la batterie.
- **Arrivée automatique** : à moins de 30 m de son point, la mission passe d'elle-même « en position ».
- **Suivi écran éteint (OwnTracks)** : depuis le navigateur, le suivi s'arrête quand le téléphone se verrouille. Les
  membres peuvent installer l'application gratuite OwnTracks, qui envoie la position même téléphone verrouillé. Leurs
  points de mission deviennent des zones : y entrer enregistre l'arrivée. Le rayon se règle dans la *Synthèse* (50 m
  par défaut). L'onglet *Coordination* liste les téléphones suivis, leur batterie, et permet de **révoquer** un suivi.
- **Vie privée** : seule la **dernière** position est conservée, sans historique. Elle n'est visible que de
  l'organisation, et elle est effacée à l'arrêt du partage, au retrait de l'équipe ou quand l'organisation désactive le
  partage. **Informez les membres** avant la manifestation (finalité, durée, droit de refuser).

## Liste de vérification avant le jour J

- [ ] Parcours importé, analyse relancée après la dernière modification.
- [ ] Tous les points ont une équipe (« ✓ Tous les points ont une équipe »).
- [ ] Chaque équipe a des membres, et si possible un responsable.
- [ ] Consignes générales et consignes d'équipe rédigées.
- [ ] Roadbooks imprimés, points vérifiés sur place.
- [ ] Membres prévenus : installer l'application sur l'écran d'accueil, batterie chargée, batterie externe.
- [ ] Si suivi de position : partage autorisé, membres informés, OwnTracks testé sur un vrai téléphone.

## En cas de problème

- **« Aucune voie reçue » ou analyse très longue** : les serveurs OpenStreetMap publics sont saturés. Rien n'est
  modifié : réessayez plus tard.
- **Le parcours ne s'affiche pas** : cliquez sur *⤢ Parcours*, ou rechargez la page.
- **« Ressource introuvable » partout** : votre session a probablement changé, par exemple si un lien d'invitation a été
  ouvert dans ce navigateur. Rechargez la page et reconnectez-vous.
- **Un membre a perdu son accès** : section *Membres* de son équipe → *Lien de récupération*.
