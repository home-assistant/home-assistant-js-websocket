import { parseQuery } from "./util";
import { ERR_HASS_HOST_REQUIRED } from "./const";

type AuthData = {
  hassUrl: string;
  expires: number;
  refresh_token: string;
  access_token: string;
  expires_in: number;
};

type SaveCacheFunc = (data: AuthData) => void;
type LoadCacheFunc = () => Promise<AuthData>;

type getAuthOptions = {
  hassUrl?: string;
  saveCache?: SaveCacheFunc;
  loadCache?: LoadCacheFunc;
};

const CALLBACK_KEY = "auth_callback";

type QueryCallbackData =
  | {}
  | {
      state: string;
      code: string;
      [CALLBACK_KEY]: string;
    };

type OAuthState = {
  hassUrl: string;
};

function genClientId() {
  return `${location.protocol}//${location.host}/`;
}

function genAuthorizeUrl(
  hassUrl: string,
  clientId: string,
  redirectUri: string,
  state: string
) {
  let authorizeUrl = `${hassUrl}/auth/authorize?response_type=code&client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  if (state) {
    authorizeUrl += `&state=${encodeURIComponent(state)}`;
  }
  return authorizeUrl;
}

function redirectAuthorize(hassUrl: string, state: string) {
  // Get current url but without # part.
  const { protocol, host, pathname, search } = location;
  let redirectUri = `${protocol}//${host}${pathname}${search}`;

  // Add either ?auth_callback=1 or &auth_callback=1
  redirectUri += redirectUri.includes("?") ? "&" : "?";
  redirectUri += `${CALLBACK_KEY}=1`;

  document.location.href = genAuthorizeUrl(
    hassUrl,
    genClientId(),
    redirectUri,
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

  if (!resp.ok) throw new Error("Unable to fetch tokens");

  const tokens: AuthData = await resp.json();
  tokens.hassUrl = hassUrl;
  tokens.expires = tokens.expires_in * 1000 + Date.now();
  return tokens;
}

function fetchToken(hassUrl: string, clientId: string, code: string) {
  return tokenRequest(hassUrl, clientId, {
    code,
    grant_type: "authorization_code"
  });
}

function refreshAccessToken(
  hassUrl: string,
  clientId: string,
  refreshToken: string
) {
  return tokenRequest(hassUrl, clientId, {
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
}

function encodeOAuthState(state: OAuthState): string {
  return btoa(JSON.stringify(state));
}

function decodeOAuthState(encoded: string): OAuthState {
  return JSON.parse(atob(encoded));
}

export class Auth {
  private _saveCache?: SaveCacheFunc;
  data: AuthData;

  constructor(data: AuthData, saveCache?: SaveCacheFunc) {
    this.data = data;
    this._saveCache = saveCache;
  }

  get wsUrl() {
    // Convert from http:// -> ws://, https:// -> wss://
    return `ws${this.data.hassUrl.substr(4)}/api/websocket`;
  }

  get accessToken() {
    return this.data.access_token;
  }

  get expired() {
    // Token needs to be at least 10 seconds valid
    return Date.now() > this.data.expires - 10000;
  }

  async refreshAccessToken() {
    this.data = await refreshAccessToken(
      this.data.hassUrl,
      genClientId(),
      this.data.refresh_token
    );
    if (this._saveCache) this._saveCache(this.data);
  }
}

export default async function getAuth({
  hassUrl,
  loadCache,
  saveCache
}: getAuthOptions = {}): Promise<Auth> {
  // Strip trailing slash.
  if (hassUrl && hassUrl.substr(hassUrl.length - 1) === "/") {
    hassUrl = hassUrl.substr(0, hassUrl.length - 1);
  }
  // Check if we came back from an authorize redirect
  const query = parseQuery<QueryCallbackData>(location.search.substr(1));

  let data: AuthData | undefined;

  // Check if we got redirected here from authorize page
  if ("auth_callback" in query) {
    // Restore state
    const state = decodeOAuthState(query.state);
    try {
      data = await fetchToken(state.hassUrl, genClientId(), query.code);
      if (saveCache) saveCache(data);
    } catch (err) {
      // Do we want to tell user we were unable to fetch tokens?
      // For now we don't do anything, having rest of code pick it up.
    }
  }

  // Check for cached tokens
  if (!data && loadCache) {
    data = await loadCache();
  }

  // If no tokens found but a hassUrl was passed in, let's go get some tokens!
  if (!data && hassUrl) {
    redirectAuthorize(
      hassUrl,
      encodeOAuthState({
        hassUrl
      })
    );
    // Just don't resolve while we navigate to next page
    return new Promise<Auth>(() => {});
  } else if (!data) {
    throw ERR_HASS_HOST_REQUIRED;
  } else {
    return new Auth(data, saveCache);
  }
}
