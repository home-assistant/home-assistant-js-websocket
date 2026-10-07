import { rejects, strictEqual } from "assert";
import { createHash } from "node:crypto";

import { Auth, getAuth } from "../dist/auth.js";
import { ERR_INVALID_AUTH, ERR_INVALID_AUTH_CALLBACK } from "../dist/errors.js";

const HASS_URL = "http://home-assistant.example";
const CLIENT_ID = "https://client.example/";
const REDIRECT_URL = "https://client.example/callback";
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const AUTH_OPTIONS = {
  hassUrl: HASS_URL,
  clientId: CLIENT_ID,
  redirectUrl: REDIRECT_URL,
};

function setBrowserGlobals(search = "") {
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
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "crypto",
)!;

function mockAuthorizationServerMetadata() {
  globalThis.fetch = async () =>
    Response.json({ code_challenge_methods_supported: ["S256"] });
}

function setAuthCallback(nonce?: string) {
  const state = btoa(
    JSON.stringify({ hassUrl: HASS_URL, clientId: CLIENT_ID, nonce }),
  );
  const browser = setBrowserGlobals(
    `?auth_callback=1&state=${encodeURIComponent(state)}&code=code`,
  );
  if (nonce !== undefined) {
    browser.storage.set(
      `hass_oauth_state_${nonce}`,
      JSON.stringify({
        codeVerifier: CODE_VERIFIER,
        state,
      }),
    );
  }
  return { ...browser, state };
}

function mockTokenRequest(status = 200) {
  const requests: FormData[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(init?.body as FormData);
    return new Response(
      JSON.stringify({
        access_token: "access-token",
        expires_in: 1800,
        refresh_token: "refresh-token",
      }),
      { status },
    );
  };
  return requests;
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
  Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
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
  it("should store a separate S256 verifier for each authorization request", async () => {
    const { location, storage } = setBrowserGlobals();
    mockAuthorizationServerMetadata();

    void getAuth(AUTH_OPTIONS);
    const authorizeUrl = await waitForAuthorizeUrl(location);
    strictEqual(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    strictEqual(authorizeUrl.searchParams.has("code_verifier"), false);
    const codeChallenge = authorizeUrl.searchParams.get("code_challenge");
    strictEqual(codeChallenge?.length, 43);
    strictEqual(/^[A-Za-z0-9_-]+$/.test(codeChallenge!), true);
    const state = JSON.parse(atob(authorizeUrl.searchParams.get("state")!)) as {
      nonce: string;
    };
    const storedState = JSON.parse(
      storage.get(`hass_oauth_state_${state.nonce}`)!,
    );
    strictEqual(storedState.state, authorizeUrl.searchParams.get("state"));
    strictEqual(
      /^[A-Za-z0-9\-._~]{43,128}$/.test(storedState.codeVerifier),
      true,
    );
    strictEqual(
      createHash("sha256").update(storedState.codeVerifier).digest("base64url"),
      codeChallenge,
    );

    location.href = "";
    void getAuth(AUTH_OPTIONS);
    const secondUrl = await waitForAuthorizeUrl(location);
    strictEqual(storage.size, 2);
    strictEqual(
      secondUrl.searchParams.get("code_challenge") === codeChallenge,
      false,
    );
    strictEqual(
      secondUrl.searchParams.get("state") === storedState.state,
      false,
    );
  });

  it("should redeem a PKCE callback and consume its state once", async () => {
    const { storage } = setAuthCallback("nonce");
    const requests = mockTokenRequest();

    await getAuth(AUTH_OPTIONS);

    strictEqual(requests[0].get("code"), "code");
    strictEqual(requests[0].get("code_verifier"), CODE_VERIFIER);
    strictEqual(storage.size, 0);
    await rejects(
      getAuth(AUTH_OPTIONS),
      (error) => error === ERR_INVALID_AUTH_CALLBACK,
    );
    strictEqual(requests.length, 1);
  });

  it("should require an exact match for callback state", async () => {
    const { location, storage, state } = setAuthCallback("nonce");
    const requests = mockTokenRequest();
    const changedState = btoa(JSON.stringify(JSON.parse(atob(state)), null, 2));
    location.search = `?auth_callback=1&state=${encodeURIComponent(changedState)}&code=code`;

    await rejects(
      getAuth(AUTH_OPTIONS),
      (error) => error === ERR_INVALID_AUTH_CALLBACK,
    );

    strictEqual(storage.size, 0);
    strictEqual(requests.length, 0);
  });

  it("should not retry a failed PKCE exchange without the verifier", async () => {
    const { storage } = setAuthCallback("nonce");
    const requests = mockTokenRequest(400);

    await rejects(getAuth(AUTH_OPTIONS), (error) => error === ERR_INVALID_AUTH);

    strictEqual(storage.size, 0);
    strictEqual(requests[0].get("code_verifier"), CODE_VERIFIER);
    await rejects(
      getAuth(AUTH_OPTIONS),
      (error) => error === ERR_INVALID_AUTH_CALLBACK,
    );
    strictEqual(requests.length, 1);
  });

  it("should continue accepting a legacy callback", async () => {
    setAuthCallback();
    const requests = mockTokenRequest();

    await getAuth(AUTH_OPTIONS);

    strictEqual(requests[0].get("code"), "code");
    strictEqual(requests[0].has("code_verifier"), false);
  });

  it("should skip discovery when crypto.subtle is unavailable", async () => {
    const { location, storage } = setBrowserGlobals();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { subtle: undefined },
    });
    const requests = mockTokenRequest();

    void getAuth(AUTH_OPTIONS);
    const authorizeUrl = await waitForAuthorizeUrl(location);
    strictEqual(authorizeUrl.searchParams.has("code_challenge"), false);
    const state = JSON.parse(atob(authorizeUrl.searchParams.get("state")!));
    strictEqual("nonce" in state, false);
    strictEqual(storage.size, 0);
    strictEqual(requests.length, 0);
  });

  for (const [name, fetchMetadata] of [
    ["missing S256", async () => Response.json({})],
    [
      "network error",
      async () => {
        throw new Error("Network unavailable");
      },
    ],
  ] as const) {
    it(`should use a legacy redirect for ${name} metadata`, async () => {
      const { location, storage } = setBrowserGlobals();
      globalThis.fetch = fetchMetadata;

      void getAuth(AUTH_OPTIONS);
      const authorizeUrl = await waitForAuthorizeUrl(location);
      strictEqual(authorizeUrl.searchParams.has("code_challenge"), false);
      strictEqual(storage.size, 0);
    });
  }
});
