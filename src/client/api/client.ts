type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface ApiError {
  error: string;
  details?: string;
  statusCode: number;
}

interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
  headers?: Record<string, string>;
  responseType?: 'json' | 'blob' | 'text';
}

const BASE_URL = '/api/v1';
const DEFAULT_TIMEOUT = 30_000;
const UPLOAD_TIMEOUT = 600_000;

let getTokens: (() => { accessToken: string | null; refreshToken: string | null }) | undefined;
let setTokens: ((access: string, refresh: string) => void) | undefined;
let clearAuth: (() => void) | undefined;

export function bindAuthStore(store: {
  getTokens: () => { accessToken: string | null; refreshToken: string | null };
  setTokens: (access: string, refresh: string) => void;
  clearAuth: () => void;
}) {
  getTokens = store.getTokens;
  setTokens = store.setTokens;
  clearAuth = store.clearAuth;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function parseResponse<T>(response: Response, responseType?: RequestOptions['responseType']) {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (responseType === 'blob' || contentType.includes('application/pdf')) {
    return (await response.blob()) as T;
  }
  if (responseType === 'text') {
    return (await response.text()) as T;
  }
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const data = (await response.json()) as { error?: string; message?: string; details?: string };
    return {
      error: data.error || data.message || 'Unexpected error',
      details: data.details,
      statusCode: response.status,
    };
  } catch {
    return {
      error: response.statusText || 'Unexpected error',
      statusCode: response.status,
    };
  }
}

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const { params, timeout = DEFAULT_TIMEOUT, headers: extraHeaders, responseType } = options;
  const url = buildUrl(path, params);
  const headers: Record<string, string> = { ...extraHeaders };

  const tokenState = getTokens?.();
  if (tokenState?.accessToken) {
    headers.Authorization = `Bearer ${tokenState.accessToken}`;
  }

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  const runRequest = () =>
    fetch(url, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

  try {
    let response = await runRequest();

    if (response.status === 401 && tokenState?.refreshToken && setTokens && clearAuth) {
      const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokenState.refreshToken }),
      });

      if (refreshResponse.ok) {
        const refreshed = (await refreshResponse.json()) as { accessToken: string; refreshToken: string };
        setTokens(refreshed.accessToken, refreshed.refreshToken);
        headers.Authorization = `Bearer ${refreshed.accessToken}`;
        response = await runRequest();
      } else {
        clearAuth();
      }
    }

    if (!response.ok) {
      throw await parseError(response);
    }

    return await parseResponse<T>(response, responseType);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw {
        error: 'Request timed out',
        statusCode: 408,
      } satisfies ApiError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
  upload: <T>(path: string, formData: FormData) =>
    request<T>('POST', path, formData, { timeout: UPLOAD_TIMEOUT }),
};
