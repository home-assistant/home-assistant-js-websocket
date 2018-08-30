import { parseQuery } from "./util";
import { ERR_HASS_HOST_REQUIRED, ERR_INVALID_AUTH } from "./errors";

export type AuthData = {
  hassUrl: string;
  clientId: string;
  expires: number;
  refresh_token: string;
  access_token: string;
  expires_in: number;
};

export type SaveTokensFunc = (data: AuthData) => void;
export type LoadTokensFunc = () => Promise<AuthData | undefined>;

export type getAuthOptions = {
  hassUrl?: string;
  clientId?: string;
  redirectUrl?: string;
  saveTokens?: SaveTokensFunc;
  loadTokens?: LoadTokensFunc;
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
  clientId: string;
};

function genClientId() {
  return `${location.protocol}//${location.host}/`;
}

function genRedirectUrl() {
  // Get current url but without # part.
  const { protocol, host, pathname, search } = location;
  return `${protocol}//${host}${pathname}${search}`;
}

function genAuthorizeUrl(
  hassUrl: string,
  clientId: string,
  redirectUrl: string,
  state: string
) {
  let authorizeUrl = `${hassUrl}/auth/authorize?response_type=code&client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(redirectUrl)}`;

  if (state) {
    authorizeUrl += `&state=${encodeURIComponent(state)}`;
  }
  return authorizeUrl;
}

function redirectAuthorize(
  hassUrl: string,
  clientId: string,
  redirectUrl: string,
  state: string
) {
  // Add either ?auth_callback=1 or &auth_callback=1
  redirectUrl += (redirectUrl.includes("?") ? "&" : "?") + "auth_callback=1";

  document.location.href = genAuthorizeUrl(
    hassUrl,
    clientId,
    redirectUrl,
    state
  );
}

async function tokenRequest(
  hassUrl: string,
  clientId: string,
  data: { [key: string]: string }
) {
  const formData = new FormData();
  formData.append("client_id", clientId);
  Object.keys(data).forEach(key => {
    formData.append(key, data[key]);
  });

  const resp = await fetch(`${hassUrl}/auth/token`, {
    method: "POST",
    body: formData
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
  tokens.expires = tokens.expires_in * 1000 + Date.now();
  return tokens;
}

function fetchToken(hassUrl: string, clientId: string, code: string) {
  return tokenRequest(hassUrl, clientId, {
    code,
    grant_type: "authorization_code"
  });
}

async function refreshAccessToken(
  hassUrl: string,
  clientId: string,
  refreshToken: string
) {
  const data = await tokenRequest(hassUrl, clientId, {
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  // Access token response does not contain refresh token.
  data.refresh_token = refreshToken;
  return data;
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

  async refreshAccessToken() {
    this.data = await refreshAccessToken(
      this.data.hassUrl,
      this.data.clientId,
      this.data.refresh_token
    );
    if (this._saveTokens) this._saveTokens(this.data);
  }
}

export async function getAuth(options: getAuthOptions = {}): Promise<Auth> {
  let data: AuthData | undefined;

  // Check if we came back from an authorize redirect
  const query = parseQuery<QueryCallbackData>(location.search.substr(1));

  // Check if we got redirected here from authorize page
  if ("auth_callback" in query) {
    // Restore state
    const state = decodeOAuthState(query.state);
    try {
      data = await fetchToken(state.hassUrl, state.clientId, query.code);
      if (options.saveTokens) options.saveTokens(data);
    } catch (err) {
      // Do we want to tell user we were unable to fetch tokens?
      // For now we don't do anything, having rest of code pick it up.
      console.log("Unable to fetch access token", err);
    }
  }

  // Check for stored tokens
  if (!data && options.loadTokens) {
    data = await options.loadTokens();
  }

  if (data) {
    return new Auth(data, options.saveTokens);
  }

  let hassUrl = options.hassUrl;

  if (hassUrl === undefined) {
    throw ERR_HASS_HOST_REQUIRED;
  }

  // Strip trailing slash.
  if (hassUrl[hassUrl.length - 1] === "/") {
    hassUrl = hassUrl.substr(0, hassUrl.length - 1);
  }
  const clientId = options.clientId || genClientId();
  const redirectUrl = options.redirectUrl || genRedirectUrl();

  // If no tokens found but a hassUrl was passed in, let's go get some tokens!
  redirectAuthorize(
    hassUrl,
    clientId,
    redirectUrl,
    encodeOAuthState({
      hassUrl,
      clientId
    })
  );
  // Just don't resolve while we navigate to next page
  return new Promise<Auth>(() => {});
}
