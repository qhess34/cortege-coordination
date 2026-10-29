// Configuration lue dans l'environnement. Aucun secret n'est versionné.
export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Cookies `Secure` (obligatoire en production derrière HTTPS). */
  cookieSecure: boolean;
  sessionTtlHours: number;
  /** Serveurs Overpass, essayés dans l'ordre (OVERPASS_URL, séparés par des virgules). */
  overpassUrls: string[];
  /** Identification envoyée à Overpass (politique d'usage OSM). */
  userAgent: string;
  maxGpxBytes: number;
  webDist: string | null;
  /** Ouvertures de lien d'invitation autorisées par minute et par adresse IP. */
  joinRateLimit: number;
  /** Tentatives de connexion autorisées par minute et par adresse IP. */
  loginRateLimit: number;
  /** Serveur d'itinéraires compatible OSRM, profil piéton (facultatif). */
  routingUrl: string | null;
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'oui'].includes(v.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant (voir .env.example).');
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl,
    cookieSecure: bool(env.COOKIE_SECURE, production),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    overpassUrls: (env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter')
      .split(',').map((u) => u.trim()).filter(Boolean),
    userAgent: env.OSM_USER_AGENT ?? 'cortege-coordination (auto-hébergé)',
    maxGpxBytes: Number(env.MAX_GPX_BYTES ?? 10 * 1024 * 1024),
    webDist: env.WEB_DIST ?? null,
    joinRateLimit: Number(env.JOIN_RATE_LIMIT ?? 30),
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT ?? 20),
    routingUrl: env.ROUTING_URL || null,
  };
}
