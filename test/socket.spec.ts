import * as assert from "assert";

import { createSocket } from "../dist/socket.js";
import { ERR_CANNOT_CONNECT, ERR_INVALID_AUTH } from "../dist/errors.js";

// A socket that stays in CONNECTING until something closes it, which is the
// state createSocket has to protect itself against.
class StalledWebSocket {
  static instances: StalledWebSocket[] = [];

  url: string;
  closeCalled = false;
  sent: any[] = [];
  private _listeners: { [event: string]: ((data: any) => void)[] } = {};

  constructor(url: string) {
    this.url = url;
    StalledWebSocket.instances.push(this);
  }

  addEventListener(event: string, callback: (data: any) => void) {
    (this._listeners[event] ||= []).push(callback);
  }

  removeEventListener(event: string, callback: (data: any) => void) {
    this._listeners[event] = (this._listeners[event] || []).filter(
      (cb) => cb !== callback,
    );
  }

  send(message: string) {
    this.sent.push(JSON.parse(message));
  }

  // Safari fires error and then close in the same tick when close() is called
  // on a socket that is still connecting.
  close() {
    this.closeCalled = true;
    this.fire("error", {});
    this.fire("close", {});
  }

  fire(event: string, data: any) {
    (this._listeners[event] || []).slice().forEach((cb) => cb(data));
  }
}

const options = (connectTimeout?: number) =>
  ({
    setupRetry: 0,
    connectTimeout,
    auth: { wsUrl: "ws://localhost:8123/api/websocket", expired: false },
  }) as any;

describe("createSocket connect timeout", () => {
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = StalledWebSocket;
    StalledWebSocket.instances = [];
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it("should close and reject a socket that never opens", async () => {
    const promise = createSocket(options(100));

    await assert.rejects(promise, (err: any) => err === ERR_CANNOT_CONNECT);
    assert.strictEqual(StalledWebSocket.instances.length, 1);
    assert.strictEqual(StalledWebSocket.instances[0].closeCalled, true);
  }).timeout(500);

  it("should not close a socket that opened", async () => {
    const promise = createSocket(options(100));
    const socket = StalledWebSocket.instances[0];

    socket.fire("open", {});
    await 0;
    socket.fire("message", {
      data: JSON.stringify({ type: "auth_ok", ha_version: "2026.9.1" }),
    });

    await promise;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(socket.closeCalled, false);
  }).timeout(500);

  it("should close and reject a socket that sends invalid JSON", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const promise = createSocket(options(0));
      const socket = StalledWebSocket.instances[0];

      socket.fire("open", {});
      await 0;
      socket.fire("message", { data: "{nuLl" });

      await assert.rejects(promise, (err: any) => err === ERR_CANNOT_CONNECT);
      assert.strictEqual(socket.closeCalled, true);
    } finally {
      console.error = originalError;
    }
  }).timeout(500);

  it("should wait indefinitely when the timeout is disabled", async () => {
    const promise = createSocket(options(0));
    promise.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(StalledWebSocket.instances[0].closeCalled, false);
  }).timeout(500);
});

describe("createSocket token refresh", () => {
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = StalledWebSocket;
    StalledWebSocket.instances = [];
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  const EXPIRED_TOKEN = "expired-token";
  const FRESH_TOKEN = "fresh-token";

  // Answers the auth message like the server would: the expired token is
  // rejected, a refreshed one is accepted.
  class AuthCheckingWebSocket extends StalledWebSocket {
    send(message: string) {
      super.send(message);
      const { type, access_token } = JSON.parse(message);
      if (type !== "auth") {
        return;
      }
      this.fire("message", {
        data: JSON.stringify(
          access_token === FRESH_TOKEN
            ? { type: "auth_ok", ha_version: "2026.9.1" }
            : { type: "auth_invalid", message: "Invalid access token" },
        ),
      });
    }
  }

  // An expired token whose refresh is still pending when the socket opens.
  // Each refresh call gets its own promise, settled by the test.
  const expiredAuth = () => {
    const pending: { resolve: () => void; reject: (err: unknown) => void }[] =
      [];
    let calls = 0;
    const auth = {
      wsUrl: "ws://localhost:8123/api/websocket",
      accessToken: EXPIRED_TOKEN,
      expired: true,
      refreshAccessToken: () =>
        new Promise<void>((resolve, reject) => {
          calls++;
          pending.push({ resolve, reject });
        }),
    };
    return {
      auth,
      refreshCalls: () => calls,
      failRefresh: (err: unknown) => pending.shift()!.reject(err),
      completeRefresh: () => {
        auth.accessToken = FRESH_TOKEN;
        auth.expired = false;
        pending.shift()!.resolve();
      },
    };
  };

  const open = async (index = 0) => {
    const socket = StalledWebSocket.instances[index];
    socket.fire("open", {});
    await 0;
    return socket;
  };

  beforeEach(() => {
    (globalThis as any).WebSocket = AuthCheckingWebSocket;
  });

  it("should not send the expired token when the refresh fails", async () => {
    const { auth, failRefresh } = expiredAuth();
    const promise = createSocket({ setupRetry: 0, auth } as any);
    const socket = await open();

    failRefresh(new Error("token endpoint unavailable"));

    await assert.rejects(promise, (err: any) => err === ERR_CANNOT_CONNECT);
    assert.strictEqual(socket.closeCalled, true);
    assert.deepStrictEqual(socket.sent, []);
  });

  it("should retry and refresh again when the refresh fails", async () => {
    const { auth, failRefresh, completeRefresh, refreshCalls } = expiredAuth();
    const promise = createSocket({ setupRetry: 1, auth } as any);
    const first = await open();

    failRefresh(new Error("token endpoint unavailable"));
    await 0;
    assert.strictEqual(first.closeCalled, true);

    // The retry is scheduled a second after the failed attempt closes.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.strictEqual(StalledWebSocket.instances.length, 2);
    const second = await open(1);
    assert.strictEqual(refreshCalls(), 2);

    completeRefresh();

    assert.strictEqual(await promise, second);
    assert.deepStrictEqual(first.sent, []);
    assert.deepStrictEqual(second.sent[0], {
      type: "auth",
      access_token: FRESH_TOKEN,
    });
  }).timeout(3000);

  it("should report invalid auth when the refresh is rejected as such", async () => {
    const { auth, failRefresh } = expiredAuth();
    const promise = createSocket({ setupRetry: 1, auth } as any);
    await open();

    failRefresh(ERR_INVALID_AUTH);

    await assert.rejects(promise, (err: any) => err === ERR_INVALID_AUTH);
    assert.strictEqual(StalledWebSocket.instances.length, 1);
  });
});
