/** Cliente HTTP da API. Erros viram ApiError com código e detalhes (pendências de schema, checklist…). */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: any) {
    super(message);
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => undefined;

export function configureApi(p: { token: () => Promise<string | null>; unauthorized: () => void }) {
  tokenProvider = p.token;
  onUnauthorized = p.unauthorized;
}

async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const token = await tokenProvider();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor.');
  }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.error ?? 'HTTP_' + res.status, j.message ?? `Erro ${res.status}`, j.details ?? (j.field ? { field: j.field } : undefined));
  }
  if (raw) return (await res.blob()) as T;
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T = any>(u: string) => request<T>('GET', u),
  post: <T = any>(u: string, b?: unknown) => request<T>('POST', u, b ?? {}),
  put: <T = any>(u: string, b?: unknown) => request<T>('PUT', u, b ?? {}),
  patch: <T = any>(u: string, b?: unknown) => request<T>('PATCH', u, b ?? {}),
  del: (u: string) => request<void>('DELETE', u),
  blob: (u: string) => request<Blob>('GET', u, undefined, true)
};

export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}
