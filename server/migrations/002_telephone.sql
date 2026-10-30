-- Téléphone (facultatif) des comptes, pour joindre la personne le jour J ; chiffres et « + » initial seulement.
ALTER TABLE users ADD COLUMN phone text CONSTRAINT users_phone_check CHECK (phone ~ '^\+?[0-9]{6,20}$');
