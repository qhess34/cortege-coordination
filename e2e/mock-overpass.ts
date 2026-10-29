// Faux serveur Overpass pour les tests de bout en bout : renvoie le réseau de référence des tests.
import { createServer } from 'node:http';
import { referenceNetwork } from '../server/test/helpers/osm.js';

const port = Number(process.env.MOCK_OVERPASS_PORT ?? 3999);
createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(referenceNetwork()));
  });
}).listen(port, '127.0.0.1');
