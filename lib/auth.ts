import { parseQuery } from "./util.js";
import {
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH,
  ERR_INVALID_AUTH_CALLBACK,
  ERR_INVALID_HTTPS_TO_HTTP,
} from "./errors.js";

export type AuthData = {
  hassUrl: string;
  clientId: string | null;
  expires: number;
  refresh_token: string;
  access_token: string;
  expires_in: number;
};

export type SaveTokensFunc = (data: AuthData | null) => void;
export type LoadTokensFunc = () => Promise<AuthData | null | undefined>;

export type getAuthOptions = {
  hassUrl?: string;
  clientId?: string | null;
  redirectUrl?: string;
  authCode?: string;
  saveTokens?: SaveTokensFunc;
  loadTokens?: LoadTokensFunc;
  limitHassInstance?: boolean;
};

type QueryCallbackData =
  | {}
  | {
      state: string;
      code: string;
      auth_callback: string;
    };

type OAuthState = {
  hassUrl: string;
  clientId: string | null;
};

type AuthorizationCodeRequest = {
  grant_type: "authorization_code";
  code: string;
};

type RefreshTokenRequest = {
  grant_type: "refresh_token";
  refresh_token: string;
};

export const genClientId = (): string =>
  `${location.protocol}//${location.host}/`;

export const genExpires = (expires_in: number): number => {
  return expires_in * 1000 + Date.now();
};

function genRedirectUrl() {
  // Get current url but without # part.
  const { protocol, host, pathname, search } = location;
  return `${protocol}//${host}${pathname}${search}`;
}

function genAuthorizeUrl(
  hassUrl: string,
  clientId: string | null,
  redirectUrl: string,
  state: string,
) {
  let authorizeUrl = `${hassUrl}/auth/authorize?response_type=code&redirect_uri=${encodeURIComponent(
    redirectUrl,
  )}`;

  if (clientId !== null) {
    authorizeUrl += `&client_id=${encodeURIComponent(clientId)}`;
  }

  if (state) {
    authorizeUrl += `&state=${encodeURIComponent(state)}`;
  }
  return authorizeUrl;
}

function redirectAuthorize(
  hassUrl: string,
  clientId: string | null,
  redirectUrl: string,
  state: string,
) {
  // Add either ?auth_callback=1 or &auth_callback=1
  redirectUrl += (redirectUrl.includes("?") ? "&" : "?") + "auth_callback=1";

  document.location!.href = genAuthorizeUrl(
    hassUrl,
    clientId,
    redirectUrl,
    state,
  );
}

async function tokenRequest(
  hassUrl: string,
  clientId: string | null,
  data: AuthorizationCodeRequest | RefreshTokenRequest,
) {
  // Browsers don't allow fetching tokens from https -> http.
  // Throw an error because it's a pain to debug this.
  // Guard against not working in node.
  const l = typeof location !== "undefined" && location;
  if (l && l.protocol === "https:") {
    // Ensure that the hassUrl is hosted on https.
    const a = document.createElement("a");
    a.href = hassUrl;
    if (a.protocol === "http:" && a.hostname !== "localhost") {
      throw ERR_INVALID_HTTPS_TO_HTTP;
    }
  }

  const formData = new FormData();
  if (clientId !== null) {
    formData.append("client_id", clientId);
  }
  Object.keys(data).forEach((key) => {
    // @ts-ignore
    formData.append(key, data[key]);
  });

  const resp = await fetch(`${hassUrl}/auth/token`, {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });

  if (!resp.ok) {
    throw resp.status === 400 /* auth invalid */ ||
      resp.status === 403 /* user not active */
      ? ERR_INVALID_AUTH
      : new Error("Unable to fetch tokens");
  }

  const tokens: AuthData = await resp.json();
  tokens.hassUrl = hassUrl;
  tokens.clientId = clientId;
  tokens.expires = genExpires(tokens.expires_in);
  return tokens;
}

function fetchToken(hassUrl: string, clientId: string | null, code: string) {
  return tokenRequest(hassUrl, clientId, {
    code,
    grant_type: "authorization_code",
  });
}

function encodeOAuthState(state: OAuthState): string {
  return btoa(JSON.stringify(state));
}

function decodeOAuthState(encoded: string): OAuthState {
  return JSON.parse(atob(encoded));
}

export class Auth {
  private _saveTokens?: SaveTokensFunc;
  data: AuthData;

  constructor(data: AuthData, saveTokens?: SaveTokensFunc) {
    this.data = data;
    this._saveTokens = saveTokens;
  }

  get wsUrl() {
    // Convert from http:// -> ws://, https:// -> wss://
    return `ws${this.data.hassUrl.substr(4)}/api/websocket`;
  }

  get accessToken() {
    return this.data.access_token;
  }

  get expired() {
    return Date.now() > this.data.expires;
  }

  /**
   * Refresh the access token.
   */
  async refreshAccessToken() {
    if (!this.data.refresh_token) throw new Error("No refresh_token");

    const data = await tokenRequest(this.data.hassUrl, this.data.clientId, {
      grant_type: "refresh_token",
      refresh_token: this.data.refresh_token,
    });
    // Access token response does not contain refresh token.
    data.refresh_token = this.data.refresh_token;
    this.data = data;
    if (this._saveTokens) this._saveTokens(data);
  }

  /**
   * Revoke the refresh & access tokens.
   */
  async revoke() {
    if (!this.data.refresh_token) throw new Error("No refresh_token to revoke");

    const formData = new FormData();
    formData.append("token", this.data.refresh_token);

    // There is no error checking, as revoke will always return 200
    await fetch(`${this.data.hassUrl}/auth/revoke`, {
      method: "POST",
      credentials: "same-origin",
      body: formData,
    });

    if (this._saveTokens) {
      this._saveTokens(null);
    }
  }
}

export function createLongLivedTokenAuth(
  hassUrl: string,
  access_token: string,
) {
  return new Auth({
    hassUrl,
    clientId: null,
    expires: Date.now() + 1e11,
    refresh_token: "",
    access_token,
    expires_in: 1e11,
  });
}

export async function getAuth(options: getAuthOptions = {}): Promise<Auth> {
  let data: AuthData | null | undefined;

  let hassUrl = options.hassUrl;
  // Strip trailing slash.
  if (hassUrl && hassUrl[hassUrl.length - 1] === "/") {
    hassUrl = hassUrl.substr(0, hassUrl.length - 1);
  }
  const clientId =
    options.clientId !== undefined ? options.clientId : genClientId();
  const limitHassInstance = options.limitHassInstance === true;

  // Use auth code if it was passed in
  if (options.authCode && hassUrl) {
    data = await fetchToken(hassUrl, clientId, options.authCode);
    if (options.saveTokens) {
      options.saveTokens(data);
    }
  }

  // Check if we came back from an authorize redirect
  if (!data) {
    const query = parseQuery<QueryCallbackData>(location.search.substr(1));

    // Check if we got redirected here from authorize page
    if ("auth_callback" in query) {
      // Restore state
      const state = decodeOAuthState(query.state);

      if (
        limitHassInstance &&
        (state.hassUrl !== hassUrl || state.clientId !== clientId)
      ) {
        throw ERR_INVALID_AUTH_CALLBACK;
      }

      data = await fetchToken(state.hassUrl, state.clientId, query.code);
      if (options.saveTokens) {
        options.saveTokens(data);
      }
    }
  }

  // Check for stored tokens
  if (!data && options.loadTokens) {
    data = await options.loadTokens();
  }

  // If the token is for another url, ignore it
  if (data && (hassUrl === undefined || data.hassUrl === hassUrl)) {
    return new Auth(data, options.saveTokens);
  }

  if (hassUrl === undefined) {
    throw ERR_HASS_HOST_REQUIRED;
  }

  // If no tokens found but a hassUrl was passed in, let's go get some tokens!
  redirectAuthorize(
    hassUrl,
    clientId,
    options.redirectUrl || genRedirectUrl(),
    encodeOAuthState({
      hassUrl,
      clientId,
    }),
  );
  // Just don't resolve while we navigate to next page
  return new Promise<Auth>(() => {});
}
