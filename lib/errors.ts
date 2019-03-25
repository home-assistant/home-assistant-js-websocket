export const ERR_CANNOT_CONNECT = "cannot_connect";
export const ERR_INVALID_AUTH = "invalid_auth";
export const ERR_CONNECTION_LOST = "connection_lost";
export const ERR_HASS_HOST_REQUIRED = "hass_host_required";
export const ERR_CANNOT_FETCH_TOKENS = "cannot_fetch_tokens";

export type ErrorCode =
  | "cannot_connect"
  | "invalid_auth"
  | "connection_lost"
  | "hass_host_required"
  | "cannot_fetch_tokens";

export class HAWSError extends Error {
  public code: ErrorCode;

  constructor(code: ErrorCode) {
    super();
    this.code = code;
  }
}
