import * as assert from "assert";

import { Connection } from "../dist/connection.js";
import { ERR_INVALID_AUTH } from "../dist/errors.js";

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  haVersion = "2026.9.0";
  sent: any[] = [];
  listeners: Record<string, ((ev: any) => void)[]> = {};

  addEventListener(type: string, cb: (ev: any) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: (ev: any) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }

  send(msg: string) {
    this.sent.push(JSON.parse(msg));
  }

  close() {
    this.readyState = 3;
    this.listeners.close?.forEach((cb) => cb({}));
  }

  receive(msg: any) {
    this.listeners.message?.forEach((cb) => cb({ data: JSON.stringify(msg) }));
  }

  succeed(type: string) {
    const id = this.sent.find((m) => m.type === type).id;
    this.receive({ id, type: "result", success: true, result: null });
    return id;
  }
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Connection subscriptions across a reconnect", () => {
  let socket: FakeSocket;
  let reconnected: FakeSocket | undefined;
  let conn: Connection;

  beforeEach(() => {
    socket = new FakeSocket();
    reconnected = undefined;
    conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => (reconnected = new FakeSocket()) as any,
    });
  });

  const subscribe = async () => {
    const promise = conn.subscribeMessage(() => {}, { type: "x" });
    socket.succeed("x");
    return promise;
  };

  it("drops a subscription unsubscribed while disconnected", async () => {
    const unsub = await subscribe();

    socket.close();
    await unsub();
    await settle();

    assert.deepStrictEqual(reconnected!.sent, []);
  });

  it("drops a subscription whose unsubscribe was cut off by the close", async () => {
    const unsub = await subscribe();

    const result = unsub();
    socket.close();
    await result;
    await settle();

    assert.deepStrictEqual(reconnected!.sent, []);
  });

  it("establishes a subscription requested while disconnected", async () => {
    socket.close();
    const subscribing = conn.subscribeMessage(() => {}, { type: "y" });
    await settle();

    assert.deepStrictEqual(
      reconnected!.sent.map((m) => m.type),
      ["y"],
    );
    reconnected!.succeed("y");
    await subscribing;
    assert.strictEqual(conn.commands.size, 1);
  });

  it("establishes a subscription when the socket closes during the pre-check", async () => {
    let passPreCheck!: (value: boolean) => void;
    const subscribing = conn.subscribeMessage(
      () => {},
      { type: "y" },
      { preCheck: () => new Promise((resolve) => (passPreCheck = resolve)) },
    );
    await settle(0);

    socket.close();
    passPreCheck(true);
    await settle();

    assert.deepStrictEqual(
      reconnected!.sent.map((m) => m.type),
      ["y"],
    );
    reconnected!.succeed("y");
    await subscribing;
  });

  it("does not keep a command sent while disconnected", async () => {
    socket.close();
    await assert.rejects(conn.sendMessagePromise({ type: "z" }));

    assert.strictEqual(conn.commands.size, 0);
  });

  it("drops a subscription unsubscribed while it is being re-established", async () => {
    const unsub = await subscribe();

    socket.close();
    await settle();
    const unsubscribing = unsub();
    const id = reconnected!.succeed("x");
    await settle(0);
    reconnected!.succeed("unsubscribe_events");
    await unsubscribing;

    assert.deepStrictEqual(
      reconnected!.sent.map((m) => m.type),
      ["x", "unsubscribe_events"],
    );
    assert.strictEqual(reconnected!.sent[1].subscription, id);
    assert.strictEqual(conn.commands.size, 0);
  });
});

describe("Connection close during reconnect", () => {
  it("closes a socket that finishes connecting after close()", async () => {
    const socket = new FakeSocket();
    let reconnected: FakeSocket | undefined;
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        await settle(10);
        return (reconnected = new FakeSocket()) as any;
      },
    });

    socket.close();
    await settle(0);
    conn.close();
    await settle(30);

    assert.strictEqual(reconnected!.readyState, 3);
    assert.strictEqual(conn.socket, undefined);
  });
});

describe("Connection close while waiting for a reconnect", () => {
  it("rejects subscriptions waiting for a socket", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: () => new Promise(() => {}),
    });

    socket.close();
    const subscribing = conn.subscribeMessage(() => {}, { type: "y" });
    conn.close();

    await assert.rejects(subscribing);
  });

  it("rejects subscriptions waiting for a socket on invalid auth", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        throw ERR_INVALID_AUTH;
      },
    });

    socket.close();
    const subscribing = conn.subscribeMessage(() => {}, { type: "y" });

    await assert.rejects(subscribing);
  });

  it("resends existing subscriptions after a suspend", async () => {
    const socket = new FakeSocket();
    let reconnected: FakeSocket | undefined;
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => (reconnected = new FakeSocket()) as any,
    });
    const subscribing = conn.subscribeMessage(() => {}, { type: "x" });
    socket.succeed("x");
    await subscribing;

    conn.suspendReconnectUntil(Promise.resolve());
    conn.suspend();
    await settle();

    assert.deepStrictEqual(
      reconnected!.sent.map((m) => m.type),
      ["x"],
    );
  });

  it("rejects messages queued after a suspend", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        await settle(10);
        return new FakeSocket() as any;
      },
    });

    conn.suspendReconnectUntil(Promise.resolve());
    conn.suspend();
    await settle(0);
    const sending = conn.sendMessagePromise({ type: "z" });
    conn.close();

    await assert.rejects(sending);
  });
});
