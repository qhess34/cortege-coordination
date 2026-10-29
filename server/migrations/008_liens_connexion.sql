-- Connexion des comptes par lien (« lien magique ») : QR code affiché sur un appareil déjà connecté, lien créé par un
-- administrateur, ou lien envoyé par e-mail. Usage unique, durée courte ; seul le hash du jeton est stocké.
ALTER TABLE users ADD COLUMN email text;
CREATE UNIQUE INDEX users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE login_links (
  id          bigserial PRIMARY KEY,
  token_hash  bytea NOT NULL UNIQUE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('appareil', 'admin', 'email')),
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX login_links_user_idx ON login_links(user_id);
