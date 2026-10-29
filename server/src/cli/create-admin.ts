// Création d'un compte administrateur en ligne de commande (premier démarrage, ou secours).
// Usage : npm run admin:create -- <identifiant> "<nom affiché>"   (mot de passe demandé, ou ADMIN_PASSWORD)
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../auth.js';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';

const [login, displayName] = process.argv.slice(2);
if (!login || !displayName) {
  console.error('Usage : npm run admin:create -- <identifiant> "<nom affiché>"');
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Mot de passe (12 caractères minimum) : ');
  rl.close();
}
if (password.length < 12) {
  console.error('Mot de passe trop court.');
  process.exit(1);
}
const db = createPool(loadConfig().databaseUrl);
await migrate(db);
const r = await db.query(
  `INSERT INTO users(login, display_name, password_hash, global_role) VALUES ($1, $2, $3, 'admin')
   ON CONFLICT (login) DO UPDATE SET password_hash = EXCLUDED.password_hash, global_role = 'admin', disabled_at = NULL
   RETURNING id`,
  [login.toLowerCase(), displayName, await hashPassword(password)],
);
await db.query("INSERT INTO audit_logs(actor_id, entity, entity_id, action) VALUES (NULL, 'user', $1, 'creation_admin_cli')", [r.rows[0].id]);
console.log('Administrateur « ' + login + ' » prêt.');
await db.end();
