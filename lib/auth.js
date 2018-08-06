import { parseQuery } from './util.js';
import { ERR_HASS_HOST_REQUIRED } from './const.js';

const CALLBACK_KEY = 'auth_callback';

function genClientId() {
  return `${location.protocol}//${location.host}/`;
}

function genAuthorizeUrl(hassUrl, clientId, redirectUri, state) {
  // eslint-disable-next-line
  let authorizeUrl = `${hassUrl}/frontend_es5/authorize.html?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  // During development, replace frontend_es5 with frontend_latest.

  if (state) {
    authorizeUrl += `&state=${encodeURIComponent(state)}`;
  }
  return authorizeUrl;
}

function redirectAuthorize(hassUrl, state) {
  let redirectUri = location.toString();
  // Add either ?auth_callback=1 or &auth_callback=1
  redirectUri += redirectUri.includes('?') ? '&' : '?';
  redirectUri += `${CALLBACK_KEY}=1`;

  document.location = genAuthorizeUrl(hassUrl, genClientId(), redirectUri, state);
}

async function tokenRequest(hassUrl, clientId, data) {
  const formData = new FormData();
  formData.append('client_id', clientId);
  Object.keys(data).forEach((key) => { formData.append(key, data[key]); });

  const resp = await fetch(`${hassUrl}/auth/token`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) throw new Error('Unable to fetch tokens');

  const tokens = await resp.json();
  tokens.hassUrl = hassUrl;
  tokens.expires = (tokens.expires_in * 1000) + Date.now();
  return tokens;
}

function fetchToken(hassUrl, clientId, code) {
  return tokenRequest(hassUrl, clientId, {
    code,
    grant_type: 'authorization_code',
  });
}

function refreshAccessToken(hassUrl, clientId, refreshToken) {
  return tokenRequest(hassUrl, clientId, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

function encodeOauthState(state) {
  return btoa(JSON.stringify(state));
}

function decodeOauthState(encoded) {
  return JSON.parse(atob(encoded));
}

class Auth {
  constructor(data, saveCache) {
    Object.assign(this, data);
    this._saveCache = saveCache;
  }

  get expired() {
    // Token needs to be at least 10 seconds valid
    return Date.now() - 10000 < this.expires;
  }

  async refreshAccessToken() {
    const data = await refreshAccessToken(this.hassUrl, genClientId(), this.refresh_token);
    Object.assign(this, data);
    if (this._saveCache) this._saveCache(data);
  }
}

export default async function getAuth({ hassUrl, loadCache, saveCache } = {}) {
  // Check if we came back from an authorize redirect
  const query = parseQuery(location.search.substr(1));

  let data;

  // Check if we got redirected here from authorize page
  if (query[CALLBACK_KEY]) {
    // Restore state
    const state = decodeOauthState(query.state);
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
    redirectAuthorize(hassUrl, encodeOauthState({
      hassUrl,
    }));
    // Just don't resolve while we navigate to next page
    return new Promise(resolve => setTimeout(resolve, 60000));
  } else if (!data) {
    throw ERR_HASS_HOST_REQUIRED;
  } else {
    return new Auth(data, saveCache);
  }
}
