/**
 * Minimal HTTP client for a self-hosted importer's portal API. Exchanges the
 * portal password for a bearer token and verifies a token against /auth/status.
 * All calls target the user's own importer over their private network.
 */

/**
 * Normalizes a user-typed address to an origin with a scheme and no trailing
 * slash, so `host:8080`, `http://host:8080`, and `http://host:8080/` all resolve
 * to the same base.
 * @param input - The raw address the user typed.
 * @returns A normalized `scheme://host[:port]` base URL.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * Exchanges the portal password for a bearer token via `POST /auth/token`.
 * @param baseUrl - The importer address.
 * @param password - The portal password.
 * @returns The bearer token string.
 * @throws Error with a user-facing message on a wrong password, a server error,
 *   or an unexpected response body.
 */
export async function requestToken(baseUrl: string, password: string): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) {
    throw new Error('Incorrect portal password.');
  }
  if (!res.ok) {
    throw new Error(`The importer returned an error (${String(res.status)}).`);
  }
  const data = (await res.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new Error('Unexpected response from the importer.');
  }
  return data.token;
}

/**
 * Reports whether a bearer token is currently authorized via `GET /auth/status`.
 * @param baseUrl - The importer address.
 * @param token - A bearer token previously issued by the importer.
 * @returns True when the importer reports the token as authorized.
 */
export async function checkAuthorized(baseUrl: string, token: string): Promise<boolean> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as { authorized?: unknown };
  return data.authorized === true;
}
