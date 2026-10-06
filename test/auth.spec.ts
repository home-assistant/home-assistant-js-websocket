import { rejects, strictEqual } from "assert";
import { createHash } from "node:crypto";

import { Auth, getAuth } from "../dist/auth.js";
import { ERR_INVALID_AUTH, ERR_INVALID_AUTH_CALLBACK } from "../dist/errors.js";

const HASS_URL = "http://home-assistant.example";
const CLIENT_ID = "https://client.example/";
const REDIRECT_URL = "https://client.example/callback";
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const AUTHORIZATION_SERVER_METADATA = {
  authorization_response_iss_parameter_supported: true,
  code_challenge_methods_supported: ["S256"],
  issuer: HASS_URL,
};

function setBrowserGlobals(search = "", secureContext = true) {
  const location = {
    href: "",
    host: "client.example",
    pathname: "/callback",
    protocol: "http:",
    search,
  };
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: location,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { location },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: secureContext },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  return { location, storage };
}

const originalFetch = globalThis.fetch;

function mockAuthorizationServerMetadata(
  metadata: object = AUTHORIZATION_SERVER_METADATA,
) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(metadata), { status: 200 });
}

async function waitForAuthorizeUrl(location: { href: string }): Promise<URL> {
  while (location.href === "") {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new URL(location.href);
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "location");
  Reflect.deleteProperty(globalThis, "sessionStorage");
  Reflect.deleteProperty(globalThis, "window");
  globalThis.fetch = originalFetch;
});

describe("Auth", () => {
  it("should indicate correctly when token expired", () => {
    const auth = new Auth({
      hassUrl: "",
      clientId: "",
      refresh_token: "",
      access_token: "",
      expires_in: 3000,
      expires: Date.now() - 1000,
    });
    strictEqual(auth.expired, true);
  });
  it("should indicate correctly when token not expired", () => {
    const auth = new Auth({
      hassUrl: "",
      clientId: "",
      refresh_token: "",
      access_token: "",
      expires_in: 3000,
      expires: Date.now() + 1000,
    });
    strictEqual(auth.expired, false);
  });
});

describe("PKCE", () => {
  it("should include PKCE in an authorization redirect", async () => {
    const { location, storage } = setBrowserGlobals();
    mockAuthorizationServerMetadata();

    void getAuth({
      hassUrl: HASS_URL,
      clientId: CLIENT_ID,
      redirectUrl: REDIRECT_URL,
    });
    const authorizeUrl = await waitForAuthorizeUrl(location);
    strictEqual(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    const codeChallenge = authorizeUrl.searchParams.get("code_challenge");
    strictEqual(codeChallenge?.length, 43);
    strictEqual(/^[A-Za-z0-9_-]+$/.test(codeChallenge!), true);
    const state = JSON.parse(atob(authorizeUrl.searchParams.get("state")!)) as {
      pkce: string;
    };
    const storedState = JSON.parse(
      storage.get(`hass_oauth_state_${state.pkce}`)!,
    );
    strictEqual(storedState.state, authorizeUrl.searchParams.get("state"));
    strictEqual(storedState.redirectUrl, `${REDIRECT_URL}?auth_callback=1`);
    strictEqual(storedState.expectedIssuer, HASS_URL);
    strictEqual(
      /^[A-Za-z0-9\-._~]{43,128}$/.test(storedState.codeVerifier),
      true,
    );
    strictEqual(
      createHash("sha256").update(storedState.codeVerifier).digest("base64url"),
      codeChallenge,
    );
  });

  it("should redeem a PKCE callback and clear its state", async () => {
    const pkce = "nonce";
    const state = btoa(
      JSON.stringify({ hassUrl: HASS_URL, clientId: CLIENT_ID, pkce }),
    );
    const { storage } = setBrowserGlobals(
      `?auth_callback=1&state=${encodeURIComponent(state)}&code=code&iss=${encodeURIComponent(HASS_URL)}`,
    );
    storage.set(
      `hass_oauth_state_${pkce}`,
      JSON.stringify({
        codeVerifier: CODE_VERIFIER,
        expectedIssuer: HASS_URL,
        redirectUrl: `${REDIRECT_URL}?auth_callback=1`,
        state,
      }),
    );
    let tokenRequest: FormData | undefined;
    globalThis.fetch = async (_input, init) => {
      tokenRequest = init?.body as FormData;
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 1800,
          refresh_token: "refresh-token",
        }),
        { status: 200 },
      );
    };

    await getAuth({ hassUrl: HASS_URL, clientId: CLIENT_ID });

    strictEqual(tokenRequest?.get("code"), "code");
    strictEqual(tokenRequest?.get("code_verifier"), CODE_VERIFIER);
    strictEqual(
      tokenRequest?.get("redirect_uri"),
      `${REDIRECT_URL}?auth_callback=1`,
    );
    strictEqual(storage.has(`hass_oauth_state_${pkce}`), false);
    await rejects(
      getAuth({ hassUrl: HASS_URL, clientId: CLIENT_ID }),
      (error) => error === ERR_INVALID_AUTH_CALLBACK,
    );
  });

  it("should reject an invalid callback issuer after clearing state", async () => {
    const pkce = "nonce";
    const state = btoa(
      JSON.stringify({ hassUrl: HASS_URL, clientId: CLIENT_ID, pkce }),
    );
    const { storage } = setBrowserGlobals(
      `?auth_callback=1&state=${encodeURIComponent(state)}&code=code&iss=https%3A%2F%2Fother.example`,
    );
    storage.set(
      `hass_oauth_state_${pkce}`,
      JSON.stringify({
        codeVerifier: CODE_VERIFIER,
        expectedIssuer: HASS_URL,
        redirectUrl: REDIRECT_URL,
        state,
      }),
    );

    await rejects(
      getAuth({ hassUrl: HASS_URL, clientId: CLIENT_ID }),
      (error) => error === ERR_INVALID_AUTH_CALLBACK,
    );
    strictEqual(storage.has(`hass_oauth_state_${pkce}`), false);
  });

  it("should reject changed callback state", async () => {
    const pkce = "nonce";
    const state = btoa(
      JSON.stringify({ hassUrl: HASS_URL, clientId: CLIENT_ID, pkce }),
    );
    const changedState = btoa(
      JSON.stringify({
        hassUrl: HASS_URL,
        clientId: "https://other.example/",
        pkce,
      }),
    );
    const { storage } = setBrowserGlobals(
      `?auth_callback=1&state=${encodeURIComponent(changedState)}&code=code&iss=${encodeURIComponent(HASS_URL)}`,
    );
    storage.set(
      `hass_oauth_state_${pkce}`,
      JSON.stringify({
        codeVerifier: CODE_VERIFIER,
        expectedIssuer: HASS_URL,
        redirectUrl: REDIRECT_URL,
        state,
      }),
    );

    await rejects(
      getAuth({ hassUrl: HASS_URL, clientId: CLIENT_ID }),
      (error) => error === ERR_INVALID_AUTH_CALLBACK,
    );
    strictEqual(storage.has(`hass_oauth_state_${pkce}`), false);
  });

  it("should continue accepting a legacy callback", async () => {
    const state = btoa(
      JSON.stringify({ hassUrl: HASS_URL, clientId: CLIENT_ID }),
    );
    setBrowserGlobals(
      `?auth_callback=1&state=${encodeURIComponent(state)}&code=code`,
    );
    let tokenRequest: FormData | undefined;
    globalThis.fetch = async (_input, init) => {
      tokenRequest = init?.body as FormData;
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 1800,
          refresh_token: "refresh-token",
        }),
        { status: 200 },
      );
    };

    await getAuth({ hassUrl: HASS_URL, clientId: CLIENT_ID });

    strictEqual(tokenRequest?.get("code"), "code");
    strictEqual(tokenRequest?.has("code_verifier"), false);
    strictEqual(tokenRequest?.has("redirect_uri"), false);
  });

  it("should fall back to a legacy redirect in an insecure context", async () => {
    const { location } = setBrowserGlobals("", false);
    mockAuthorizationServerMetadata();

    void getAuth({
      hassUrl: HASS_URL,
      clientId: CLIENT_ID,
      redirectUrl: REDIRECT_URL,
    });
    const authorizeUrl = await waitForAuthorizeUrl(location);
    strictEqual(authorizeUrl.searchParams.has("code_challenge"), false);
    const state = JSON.parse(atob(authorizeUrl.searchParams.get("state")!));
    strictEqual("pkce" in state, false);
  });

  it("should fall back when the server does not advertise S256", async () => {
    const { location } = setBrowserGlobals();
    mockAuthorizationServerMetadata({ issuer: HASS_URL });

    void getAuth({
      hassUrl: HASS_URL,
      clientId: CLIENT_ID,
      redirectUrl: REDIRECT_URL,
    });
    const authorizeUrl = await waitForAuthorizeUrl(location);
    strictEqual(authorizeUrl.searchParams.has("code_challenge"), false);
    const state = JSON.parse(atob(authorizeUrl.searchParams.get("state")!));
    strictEqual("pkce" in state, false);
  });

  it("should accept PKCE without iss when the server does not advertise it", async () => {
    const pkce = "nonce";
    const state = btoa(
      JSON.stringify({ hassUrl: HASS_URL, clientId: CLIENT_ID, pkce }),
    );
    const { storage } = setBrowserGlobals(
      `?auth_callback=1&state=${encodeURIComponent(state)}&code=code`,
    );
    storage.set(
      `hass_oauth_state_${pkce}`,
      JSON.stringify({
        codeVerifier: CODE_VERIFIER,
        redirectUrl: `${REDIRECT_URL}?auth_callback=1`,
        state,
      }),
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 1800,
          refresh_token: "refresh-token",
        }),
        { status: 200 },
      );

    await getAuth({ hassUrl: HASS_URL, clientId: CLIENT_ID });

    strictEqual(storage.has(`hass_oauth_state_${pkce}`), false);
  });

  it("should reject malformed issuer metadata", async () => {
    const { location } = setBrowserGlobals();
    mockAuthorizationServerMetadata({
      authorization_response_iss_parameter_supported: true,
      code_challenge_methods_supported: ["S256"],
    });

    await rejects(
      getAuth({
        hassUrl: HASS_URL,
        clientId: CLIENT_ID,
        redirectUrl: REDIRECT_URL,
      }),
      (error) => error === ERR_INVALID_AUTH,
    );
    strictEqual(location.href, "");
  });

  it("should reject when storage is unavailable in a secure context", async () => {
    const { location } = setBrowserGlobals();
    mockAuthorizationServerMetadata();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("Storage unavailable");
        },
      },
    });

    await rejects(
      getAuth({
        hassUrl: HASS_URL,
        clientId: CLIENT_ID,
        redirectUrl: REDIRECT_URL,
      }),
      /Storage unavailable/,
    );
    strictEqual(location.href, "");
  });
});
