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
6. **Ajouter les membres** à leur équipe (leurs comptes sont créés par un administrateur).
7. **Imprimer les roadbooks** et vérifier les points sur place.
8. Le jour J, suivre tout depuis l'onglet **Coordination**.

## Se connecter et installer l'application

- **Identifiant et mot de passe**, ou **lien de connexion** (onglet *Lien de connexion* de la première page) :
  - **depuis un appareil déjà connecté** : menu **📱 Connecter un appareil**, puis scannez le QR code avec votre téléphone.
    Il est connecté sans mot de passe. Le QR code vaut 10 minutes et ne sert qu'une fois ;
  - **lien créé par un administrateur** (page *Comptes* → *Lien de connexion*), valable 72 h et une seule fois, à
    transmettre par un canal sûr ;
  - **par e-mail** (« Recevoir un lien par e-mail »), si le serveur d'envoi est configuré et que le compte a une adresse
    e-mail. Le lien vaut 15 minutes.
- **Installer l'application** sur le téléphone : bouton *Installer* (Android, Chrome) ; sur iPhone, dans Safari, bouton
  Partager → *Sur l'écran d'accueil*. L'application s'ouvre alors en plein écran depuis l'écran d'accueil.

## Deux interfaces

Chaque manifestation de la liste propose deux boutons :

- **🗺 Planifier** : l'interface complète, pensée pour un **ordinateur**. Elle sert à préparer la manifestation :
  parcours, suggestions, points, équipes, membres, roadbooks.
- **📱 Coordination en direct** : l'interface du jour J, pensée pour le **téléphone**. Une barre d'onglets en bas
  d'écran donne accès à :
  - *Direct* : compteurs, prochains points et état des équipes ;
  - *Incidents*, avec un badge du nombre d'incidents ouverts ;
  - *Équipes* : statut de chaque point ;
  - *Messages* ;
  - *Carte* : points colorés selon leur statut, incidents et membres suivis.

  Tout se met à jour en direct. Le lien *🗺 Planification* ramène à l'interface complète.

## Comptes et accès

- Il n'y a **pas d'inscription en ligne**. Les comptes d'organisation sont créés par un administrateur (lien *Comptes*
  dans la barre du haut, réservé aux administrateurs). Il y a deux sortes de comptes :
  - **Membre d'équipe** : prénom, nom, e-mail et téléphone facultatifs. Pas d'identifiant ni de mot de passe : à la création,
    l'administrateur obtient un **lien d'activation** (72 h, une seule fois) à transmettre à la personne (SMS, messagerie).
    En l'ouvrant, elle est connectée sur son téléphone pour plusieurs jours. Ensuite, elle se reconnecte par lien :
    e-mail (si elle a renseigné son adresse), QR code depuis un autre de ses appareils, ou nouveau lien envoyé par
    l'organisation. Un membre ne voit que **ses équipes** (vue terrain), jamais la planification.
  - **Organisateur** (ou administrateur) : identifiant et mot de passe, en plus de la connexion par lien.
- **Expiration** (facultative) : à la date choisie, le compte est **supprimé automatiquement**. C'est pratique pour les
  membres recrutés pour une seule manifestation. Elle se modifie dans *Comptes* → *Modifier*, où l'on peut aussi
  désactiver ou supprimer un compte, ou le déconnecter de tous ses appareils.
- Pour donner accès à une manifestation à un autre compte : onglet *Synthèse*, bloc **Accès des comptes**. Cherchez la
  personne et choisissez son rôle :
  - **Organisateur** : peut tout modifier ;
  - **Responsable** : consulte la manifestation et gère son équipe si l'organisation le permet ;
  - **Membre** : consulte seulement.
- Chaque personne gère son **profil** (prénom, nom, e-mail, téléphone) depuis le lien *Profil*.
- **Téléphone** : saisi par l'administrateur ou par la personne. Il est cliquable (📞) pour l'organisation dans la liste
  des membres de l'équipe et dans *Coordination* (« Joindre l'équipe »), et pour les responsables dans leur liste de
  membres. Le numéro d'un **responsable** est aussi affiché aux membres de son équipe, dans leur vue terrain.

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
  - **Membres** : ajouter, retirer, envoyer un lien de connexion (voir ci-dessous).
  - **Réglages** : nom, couleur, type, responsable (compte), consignes de l'équipe, désactivation.
- On peut aussi affecter une équipe depuis la **bulle d'un point** sur la carte. Les points prennent la couleur de leur
  équipe.

### Les membres d'une équipe

Dans la section **Membres** d'une équipe :

- **Ajouter un membre** : cherchez la personne par son nom ou son e-mail, puis *Ajouter* ou **Ajouter comme
  responsable**. Vous pouvez ajouter les comptes « membre d'équipe » et les comptes d'organisation qui ont accès à la
  manifestation.
- **Nommer responsable** / **Retirer « responsable »** : change le rôle d'un membre déjà dans l'équipe. Seule
  l'organisation désigne les responsables ; ils suivent les incidents de l'équipe, et leur téléphone est affiché aux
  membres.
- **Lien de connexion** : pour un membre qui a perdu son accès ou changé de téléphone. Le lien vaut 72 h et ne sert
  qu'une fois ; il n'est **affiché qu'une fois**, copiez-le aussitôt et transmettez-le-lui.
- **Retirer** : le membre perd aussitôt l'accès aux missions de l'équipe. Sa position partagée est effacée.
- Réglage d'équipe : **« Les responsables peuvent ajouter et retirer des membres »**. Ils le font alors depuis leur vue
  terrain (*Gérer les membres de l'équipe*).

> Le compte d'un membre est créé par un administrateur (page *Comptes*), qui lui transmet son lien d'activation.

## Roadbooks et exports

- **Roadbook** complet ou par équipe (bas de l'onglet *Équipes*, ou section *Points* d'une équipe). Il contient les
  cartes zoomées de chaque lieu, les consignes et les points regroupés par lieu, et il est prêt à imprimer.
- **GPX de l'équipe** (lien *⬇ GPX de l'équipe* sur chaque équipe) : un **POI par point** de l'équipe, numéroté dans
  l'ordre des missions, avec le parcours. À ouvrir dans OsmAnd, Organic Maps, un GPS… Les membres le téléchargent
  aussi depuis leur vue terrain (*Points restants*).
- **GPX de tous les points** (bas de l'onglet *Équipes*), à charger dans une application de navigation.
- **↺ Remettre toutes les missions à « Affectée »** (bas de l'onglet *Équipes*, ou réglages d'une équipe pour elle
  seule) : après une répétition, ou pour repartir de zéro. Les affectations et l'ordre sont conservés ; les incidents,
  les messages et la progression ne sont pas effacés.

## Le jour J : onglet Coordination

Sur téléphone, préférez **📱 Coordination en direct** : mêmes informations, mêmes actions, en onglets. Sur ordinateur,
tout s'y met à jour **en direct**. L'indicateur **● direct** à côté du nom de la manifestation le confirme ; en cas de
coupure, l'écran se recharge toutes les 30 secondes.

- **Compteurs** : incidents ouverts, tête et queue du cortège, **points à lever**.
- **Prochains points devant la tête** : les six points suivants sur le parcours, avec la distance depuis la tête, leurs
  équipes et leur état, le plus grave d'abord : **🆘 Besoin d'aide** (demande d'aide en cours), **⚠ Incident**,
  *Relève nécessaire*, **✓ Équipe en position**, *Personne · équipe en route*, **Personne** (aucune équipe sur place),
  *Levé* (missions terminées). Tant que la tête n'est pas connue, la liste part du départ.
- **Équipes** (onglet *Direct*) : le statut résumé de chaque équipe (le plus urgent d'abord : incident, relève, en
  route, en position…), son responsable et des raccourcis pour le joindre : **📞 appel** et **💬 SMS** si son
  téléphone est renseigné, **✉ message** dans l'application à toute l'équipe.
- **Progression du cortège** : si le partage de position est autorisé, la tête et la queue avancent **automatiquement**
  avec les positions des membres de l'**ouverture** (le plus avancé) et de la **fermeture** (le plus en arrière),
  ramenées sur le parcours (au plus une mise à jour par minute ; positions à plus de 150 m du parcours ou trop
  imprécises ignorées). Sinon, l'ouverture (tête) et la fermeture (queue) la déclarent depuis leur vue terrain, en km
  parcourus ou « 📍 ici ». Les compteurs *Tête* et *Queue* de l'écran *Direct* la reprennent ; chaque membre voit à
  quelle distance la tête se trouve de son point. C'est une indication, à confirmer sur le terrain.
- **Incidents** : les prioritaires (aide, santé, sécurité) en premier. *Je m'en occupe* indique à l'équipe que c'est
  pris en charge, *Résolu* clôt l'incident. L'équipe volante peut aussi les prendre en charge ; elle a un lien **🧭 Rejoindre le lieu** vers chaque demande d'aide.
- **Équipes** : statut de chaque point (qui l'a changé, quand), nombre de membres actifs, badge **à lever** quand la
  queue a dépassé un point encore tenu.
- **Messages** : à toutes les équipes ou à une seule, éventuellement **urgents** (bandeau rouge sur les téléphones).
  « lu 3/5 » indique les accusés de lecture. Les réponses des équipes s'affichent ici.

> L'application ne prévient pas les secours. En cas d'urgence vitale, appelez le 15, le 17, le 18 ou le 112.

## Suivi des positions (facultatif)

- **Activer** : onglet *Synthèse* de la manifestation → bouton **Modifier** (sous le titre) → cochez **Autoriser le
  partage de position en direct** → **Enregistrer**. Il faut être organisateur de la manifestation.
- Le bloc **Partager ma position** apparaît alors dans l'onglet *Mission* de la vue terrain de chaque membre (après
  rechargement ou au prochain signal du direct). **Chaque membre choisit** de partager sa position, ou non.
- La page doit être servie en **HTTPS** (sauf `localhost`) : sinon le navigateur refuse la géolocalisation.
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
- [ ] Comptes des membres créés (avec une date d'expiration si besoin) et liens d'activation transmis.
- [ ] Chaque équipe a des membres, et si possible un responsable.
- [ ] Consignes générales et consignes d'équipe rédigées.
- [ ] Roadbooks imprimés, points vérifiés sur place.
- [ ] Membres prévenus : installer l'application sur l'écran d'accueil, batterie chargée, batterie externe.
- [ ] Si suivi de position : partage autorisé, membres informés, OwnTracks testé sur un vrai téléphone.

## En cas de problème

- **« Aucune voie reçue » ou analyse très longue** : les serveurs OpenStreetMap publics sont saturés. Rien n'est
  modifié : réessayez plus tard.
- **Le parcours ne s'affiche pas** : cliquez sur *⤢ Parcours*, ou rechargez la page.
- **« Ressource introuvable » partout** : votre session a probablement changé, par exemple si un lien de connexion d'un
  autre compte a été ouvert dans ce navigateur. Rechargez la page et reconnectez-vous.
- **Un membre a perdu son accès** : section *Membres* de son équipe → *Lien de connexion*.
- **Un membre a disparu des comptes** : son compte a atteint sa date d'expiration et a été supprimé. Un administrateur
  peut en créer un nouveau.
