export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; JobSpyMCP/1.0)',
        accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 15000, fetchImpl = globalThis.fetch) {
  const response = await fetchWithTimeout(url, options, timeoutMs, fetchImpl);
  return response.json();
}
