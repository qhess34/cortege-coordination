// Accès à l'API. Le cookie de session (HttpOnly) est envoyé par le navigateur ; aucun jeton n'est manipulé ici.
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { 'x-requested-with': 'cortege' } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: { error?: string; details?: unknown } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non JSON : page d'erreur d'un proxy (délai dépassé, serveur arrêté…).
    if (res.ok) throw new ApiError(res.status, 'Réponse inattendue du serveur.');
    throw new ApiError(
      res.status,
      res.status >= 502 && res.status <= 504
        ? 'Le serveur n’a pas répondu à temps (HTTP ' + res.status + '). Réessayez dans un instant.'
        : 'Erreur du serveur (HTTP ' + res.status + ').',
    );
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'Erreur ' + res.status, json?.details);
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  delete: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
};
