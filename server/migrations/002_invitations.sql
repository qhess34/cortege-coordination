-- Lot 2 : participants sans compte classique, appartenance aux équipes, invitations (QR code d'équipe et lien
-- individuel), demandes d'admission.

-- Un participant est un compte sans identifiant ni mot de passe, rattaché à une seule manifestation.
ALTER TABLE users ADD COLUMN account_type text NOT NULL DEFAULT 'compte' CHECK (account_type IN ('compte', 'participant'));
ALTER TABLE users ADD COLUMN event_id bigint REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE users ALTER COLUMN login DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_kind_check CHECK (
  (account_type = 'compte' AND login IS NOT NULL AND event_id IS NULL)
  OR (account_type = 'participant' AND login IS NULL AND password_hash IS NULL AND global_role = 'aucun' AND event_id IS NOT NULL)
);
CREATE INDEX users_event_idx ON users(event_id) WHERE event_id IS NOT NULL;

-- Les responsables d'équipe peuvent, si l'organisateur le permet, gérer les invitations de leur équipe.
ALTER TABLE teams ADD COLUMN leader_can_invite boolean NOT NULL DEFAULT false;

CREATE TABLE team_memberships (
  team_id    bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'membre' CHECK (role IN ('membre', 'responsable')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  invitation_id bigint,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_memberships_user_idx ON team_memberships(user_id);

-- Invitations. Lien individuel : seul le hash du jeton est conservé (il n'est montré qu'à la création).
-- QR code d'équipe : jeton conservé pour pouvoir réafficher et réimprimer le QR ; il ne donne que le rôle de membre,
-- avec limites (durée, nombre d'utilisations, suspension, validation) et se régénère.
CREATE TABLE invitations (
  id             bigserial PRIMARY KEY,
  event_id       bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id        bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('equipe', 'individuelle')),
  token_hash     bytea NOT NULL UNIQUE,
  public_token   text UNIQUE,
  admission      text NOT NULL CHECK (admission IN ('immediate', 'validation')),
  role           text NOT NULL DEFAULT 'membre' CHECK (role IN ('membre', 'responsable')),
  label          text NOT NULL DEFAULT '',
  max_uses       integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses           integer NOT NULL DEFAULT 0,
  expires_at     timestamptz,
  suspended      boolean NOT NULL DEFAULT false,
  revoked_at     timestamptz,
  -- Lien de récupération d'accès : rattaché à un participant existant.
  participant_id bigint REFERENCES users(id) ON DELETE CASCADE,
  created_by     bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'equipe') = (public_token IS NOT NULL)),
  CHECK (kind = 'individuelle' OR (role = 'membre' AND participant_id IS NULL)),
  CHECK (kind = 'equipe' OR max_uses = 1)
);
CREATE INDEX invitations_team_idx ON invitations(team_id);
ALTER TABLE team_memberships ADD CONSTRAINT team_memberships_invitation_fk FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE SET NULL;

CREATE TABLE admission_requests (
  id            bigserial PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id       bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invitation_id bigint REFERENCES invitations(id) ON DELETE SET NULL,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'membre' CHECK (role IN ('membre', 'responsable')),
  status        text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'acceptee', 'refusee')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX admission_requests_team_idx ON admission_requests(team_id, status);
