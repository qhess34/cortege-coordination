-- Les membres d'équipe ont désormais un compte, créé par un administrateur (rôle global « membre », sans identifiant
-- ni mot de passe : connexion par lien). Les QR codes et liens d'invitation d'équipe disparaissent. Chaque compte peut
-- avoir une date d'expiration, après laquelle il est supprimé automatiquement.

ALTER TABLE users ADD COLUMN first_name text NOT NULL DEFAULT '' CHECK (length(first_name) <= 80);
ALTER TABLE users ADD COLUMN last_name text NOT NULL DEFAULT '' CHECK (length(last_name) <= 80);
ALTER TABLE users ADD COLUMN expires_at timestamptz;

ALTER TABLE users DROP CONSTRAINT users_kind_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_global_role_check;
ALTER TABLE users ADD CONSTRAINT users_global_role_check CHECK (global_role IN ('admin', 'organisateur', 'membre', 'aucun'));

-- Participants existants → comptes membres, qui expirent au lendemain de leur manifestation.
UPDATE users u SET global_role = 'membre',
       expires_at = coalesce((SELECT coalesce(e.ends_at, e.starts_at) + interval '1 day' FROM events e WHERE e.id = u.event_id), now() + interval '30 days')
 WHERE u.account_type = 'participant';
DELETE FROM event_memberships m USING users u WHERE u.id = m.user_id AND u.global_role = 'membre';

ALTER TABLE team_memberships DROP COLUMN invitation_id;
DROP TABLE admission_requests;
DROP TABLE invitations;
ALTER TABLE teams RENAME COLUMN leader_can_invite TO leader_can_manage;

DROP INDEX IF EXISTS users_event_idx;
ALTER TABLE users DROP COLUMN event_id;
ALTER TABLE users DROP COLUMN account_type;
-- Seuls les membres peuvent se passer d'identifiant (connexion par lien uniquement).
ALTER TABLE users ADD CONSTRAINT users_login_required_check CHECK (login IS NOT NULL OR global_role = 'membre');
CREATE INDEX users_expires_idx ON users(expires_at) WHERE expires_at IS NOT NULL;

-- Lien de connexion envoyé par l'organisation d'une équipe à l'un de ses membres (nouveau téléphone, accès perdu).
ALTER TABLE login_links DROP CONSTRAINT login_links_kind_check;
ALTER TABLE login_links ADD CONSTRAINT login_links_kind_check CHECK (kind IN ('appareil', 'admin', 'email', 'equipe'));
