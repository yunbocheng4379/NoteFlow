const DEFAULT_PROXY_TARGET = 'http://127.0.0.1:8483'

export function resolveProxyTarget(apiBaseUrl, configuredProxyTarget) {
  const explicitTarget = configuredProxyTarget?.trim()
  if (explicitTarget) {
    return explicitTarget.replace(/\/+$/, '')
  }

  const baseUrl = apiBaseUrl?.trim()
  if (!baseUrl || baseUrl.startsWith('/')) {
    return DEFAULT_PROXY_TARGET
  }

  try {
    return new URL(baseUrl).origin
  }
  catch {
    return DEFAULT_PROXY_TARGET
  }
}
