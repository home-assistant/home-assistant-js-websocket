import * as assert from "assert";

import { createSocket } from "../dist/socket.js";
import { ERR_CANNOT_CONNECT } from "../dist/errors.js";

// A socket that stays in CONNECTING until something closes it, which is the
// state createSocket has to protect itself against.
class StalledWebSocket {
  static instances: StalledWebSocket[] = [];

  closeCalled = false;
  private _listeners: { [event: string]: ((data: any) => void)[] } = {};

  constructor(public url: string) {
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

  send(message: string) {}

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

  it("should wait indefinitely when the timeout is disabled", async () => {
    const promise = createSocket(options(0));
    promise.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(StalledWebSocket.instances[0].closeCalled, false);
  }).timeout(500);
});
