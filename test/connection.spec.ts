import * as assert from "assert";

import { Connection } from "../dist/connection.js";

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

    const result = unsub().catch((err) => err);
    socket.close();
    await result;
    await settle();

    assert.deepStrictEqual(reconnected!.sent, []);
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
