import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';

const db = createPool(loadConfig().databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? 'Migrations appliquées : ' + applied.join(', ') : 'Base à jour.');
await db.end();
