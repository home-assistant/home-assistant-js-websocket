export const ERR_CANNOT_CONNECT = 1;
export const ERR_INVALID_AUTH = 2;
export const ERR_CONNECTION_LOST = 3;
export const ERR_HASS_HOST_REQUIRED = 4;
export const ERR_INVALID_HTTPS_TO_HTTP = 5;
export const ERR_INVALID_AUTH_CALLBACK = 6;

/**
 * Whether a rejection means the connection was lost, either as the bare
 * ERR_CONNECTION_LOST code or as an error result with that code.
 */
export const isConnectionLost = (err: unknown) =>
  err === ERR_CONNECTION_LOST ||
  (err as { error?: { code?: number } } | undefined)?.error?.code ===
    ERR_CONNECTION_LOST;
