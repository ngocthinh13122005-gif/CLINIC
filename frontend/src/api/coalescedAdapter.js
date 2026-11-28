// Share only identical GET requests that are still in flight; never retain response data.
export function coalesceGets(adapter, getUri) {
  const pending = new Map();
  return (config) => {
    if ((config.method || 'get').toLowerCase() !== 'get') {
      pending.clear();
      return Promise.resolve().then(() => adapter(config)).finally(() => pending.clear());
    }
    // Each abortable caller must retain control of its own request.
    if (config.signal || config.cancelToken) return adapter(config);
    const key = JSON.stringify([getUri(config), config.headers?.toJSON?.() || config.headers,
      config.responseType, config.withCredentials, config.timeout]);
    let request = pending.get(key);
    if (!request) {
      request = Promise.resolve().then(() => adapter(config)).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
    }
    // Axios transforms each response separately, including JSON parsing.
    return request.then((response) => ({ ...response, config }));
  };
}
