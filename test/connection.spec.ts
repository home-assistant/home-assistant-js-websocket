import * as assert from "assert";

import { Connection } from "../dist/connection.js";
import { getCollection } from "../dist/collection.js";
import { ERR_CONNECTION_LOST, ERR_INVALID_AUTH } from "../dist/errors.js";
import { unhandledDuring } from "./util.ts";

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  haVersion = "2026.9.0";
  sent: any[] = [];
  listeners: Record<string, ((ev: any) => void)[]> = {};
  // Fire the close event later, like a real WebSocket.
  asyncClose = false;

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
    const fire = () => {
      this.readyState = 3;
      this.listeners.close?.forEach((cb) => cb({}));
    };
    if (this.asyncClose) {
      this.readyState = 2;
      setTimeout(fire, 0);
    } else {
      fire();
    }
  }

  receive(msg: any) {
    this.listeners.message?.forEach((cb) => cb({ data: JSON.stringify(msg) }));
  }

  succeed(type: string) {
    const id = this.sent.findLast((m) => m.type === type).id;
    this.receive({ id, type: "result", success: true, result: null });
    return id;
  }

  fail(type: string, code = "unknown_command") {
    const id = this.sent.findLast((m) => m.type === type).id;
    this.receive({
      id,
      type: "result",
      success: false,
      error: { code, message: "Unknown command." },
    });
    return id;
  }
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const outcome = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    settle(60).then(() => "pending"),
  ]);

const trackUnhandled = () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  return {
    unhandled,
    stop: () => process.off("unhandledRejection", onUnhandled),
  };
};

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
    await assert.rejects(conn.sendMessagePromise({ type: "z" }), {
      error: { code: ERR_CONNECTION_LOST, message: "Connection lost" },
    });

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

    await assert.rejects(sending, {
      error: { code: ERR_CONNECTION_LOST, message: "Connection lost" },
    });
  });
});

describe("Connection settles subscriptions that can't recover", () => {
  it("rejects a subscription in flight when close() is called", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => new FakeSocket() as any,
    });

    const subscribing = conn.subscribeMessage(() => {}, { type: "x" });
    conn.close();

    assert.strictEqual(await outcome(subscribing), "rejected");
  });

  it("rejects a subscription made after close() before the socket closed", async () => {
    const socket = new FakeSocket();
    socket.asyncClose = true;
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => new FakeSocket() as any,
    });

    conn.close();
    const subscribing = conn.subscribeMessage(() => {}, { type: "x" });

    assert.strictEqual(await outcome(subscribing), "rejected");
  });

  it("rejects a subscription made after reconnecting failed on invalid auth", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        throw ERR_INVALID_AUTH;
      },
    });

    socket.close();
    await settle();
    const subscribing = conn.subscribeMessage(() => {}, { type: "x" });

    assert.strictEqual(await outcome(subscribing), "rejected");
  });

  it("rejects an in flight subscription that won't be resubscribed", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => new FakeSocket() as any,
    });

    const subscribing = conn.subscribeMessage(
      () => {},
      { type: "x" },
      { resubscribe: false },
    );
    socket.close();
    await settle();

    assert.strictEqual(await outcome(subscribing), "rejected");
  });
});

describe("Connection after close()", () => {
  it("rejects waiting subscriptions with a connection lost error", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: () => new Promise(() => {}),
    });

    socket.close();
    const subscribing = conn.subscribeMessage(() => {}, { type: "y" });
    conn.close();

    await assert.rejects(subscribing, {
      error: { code: ERR_CONNECTION_LOST, message: "Connection lost" },
    });
  });

  it("does not fire reconnect-error when auth fails after close()", async () => {
    const socket = new FakeSocket();
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        await settle(10);
        throw ERR_INVALID_AUTH;
      },
    });
    let reconnectErrors = 0;
    conn.addEventListener("reconnect-error", () => reconnectErrors++);

    socket.close();
    await settle(0);
    conn.close();
    await settle(30);

    assert.strictEqual(reconnectErrors, 0);
  });

  it("does not leave an unhandled rejection in a collection", async () => {
    const tracker = trackUnhandled();
    try {
      const socket = new FakeSocket();
      const conn = new Connection(socket as any, {
        setupRetry: 0,
        createSocket: async () => new FakeSocket() as any,
      });
      const coll = getCollection(conn, "_test", undefined, (conn) =>
        conn.subscribeMessage(() => {}, { type: "x" }),
      );
      coll.subscribe(() => {});
      await settle(0);

      conn.close();
      await settle();

      assert.deepStrictEqual(tracker.unhandled, []);
    } finally {
      tracker.stop();
    }
  });
});

describe("Connection failed resubscribe", () => {
  it("resolves unsubscribe when the pre-check fails on reconnect", async () => {
    const tracker = trackUnhandled();
    try {
      const socket = new FakeSocket();
      let reconnected: FakeSocket | undefined;
      const conn = new Connection(socket as any, {
        setupRetry: 0,
        createSocket: async () => (reconnected = new FakeSocket()) as any,
      });
      let preCheckPasses = true;
      const subscribing = conn.subscribeMessage(
        () => {},
        { type: "x" },
        { preCheck: () => preCheckPasses },
      );
      await settle(0);
      socket.succeed("x");
      const unsub = await subscribing;

      preCheckPasses = false;
      socket.close();
      await settle();

      assert.deepStrictEqual(reconnected!.sent, []);
      assert.strictEqual(await outcome(unsub()), "resolved");
      assert.deepStrictEqual(tracker.unhandled, []);
    } finally {
      tracker.stop();
    }
  });

  it("resolves unsubscribe when close() is called during the resubscribe pre-check", async () => {
    const tracker = trackUnhandled();
    try {
      const socket = new FakeSocket();
      let reconnected: FakeSocket | undefined;
      const conn = new Connection(socket as any, {
        setupRetry: 0,
        createSocket: async () => (reconnected = new FakeSocket()) as any,
      });
      let preChecks = 0;
      let passPreCheck!: (value: boolean) => void;
      const subscribing = conn.subscribeMessage(
        () => {},
        { type: "x" },
        {
          preCheck: () =>
            preChecks++ === 0
              ? true
              : new Promise<boolean>((resolve) => (passPreCheck = resolve)),
        },
      );
      await settle(0);
      socket.succeed("x");
      const unsub = await subscribing;

      socket.close();
      await settle();
      reconnected!.close();
      conn.close();
      passPreCheck(true);
      await settle();

      assert.strictEqual(await outcome(unsub()), "resolved");
      assert.deepStrictEqual(tracker.unhandled, []);
    } finally {
      tracker.stop();
    }
  });
});

describe("Connection resubscribe rejected by Home Assistant", () => {
  let sockets: FakeSocket[];
  let socket: FakeSocket;
  let conn: Connection;

  beforeEach(() => {
    sockets = [];
    socket = new FakeSocket();
    conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        const created = new FakeSocket();
        sockets.push(created);
        return created as any;
      },
    });
  });

  afterEach(() => conn.close());

  const subscribe = async (callback: (ev: any) => void = () => {}) => {
    const subscribing = conn.subscribeMessage(callback, { type: "x" });
    socket.succeed("x");
    return subscribing;
  };

  const rejectResubscribe = async () => {
    socket.close();
    await settle();
    sockets[0].fail("x");
    await settle(0);
  };

  const sentTypes = (sock: FakeSocket) => sock.sent.map((m) => m.type);

  it("retries until the subscription is back", async function () {
    this.timeout(3000);
    const tracker = trackUnhandled();
    try {
      const events: unknown[] = [];
      const unsub = await subscribe((ev) => events.push(ev));

      await rejectResubscribe();
      assert.deepStrictEqual(sentTypes(sockets[0]), ["x"]);

      // The first retry is after a second.
      await settle(1100);
      assert.deepStrictEqual(sentTypes(sockets[0]), ["x", "x"]);
      const id = sockets[0].succeed("x");
      sockets[0].receive({ id, type: "event", event: "fired" });
      assert.deepStrictEqual(events, ["fired"]);

      const unsubscribing = unsub();
      await settle(0);
      sockets[0].succeed("unsubscribe_events");
      await unsubscribing;
      assert.strictEqual(sockets[0].sent[2].subscription, id);
      assert.strictEqual(conn.commands.size, 0);
      assert.deepStrictEqual(tracker.unhandled, []);
    } finally {
      tracker.stop();
    }
  });

  it("stops retrying once unsubscribed", async function () {
    this.timeout(3000);
    const unsub = await subscribe();

    await rejectResubscribe();
    assert.strictEqual(await outcome(unsub()), "resolved");
    await settle(1100);

    assert.deepStrictEqual(sentTypes(sockets[0]), ["x"]);
  });

  it("stops retrying when the connection is closed", async function () {
    this.timeout(3000);
    await subscribe();

    await rejectResubscribe();
    conn.close();
    await settle(1100);

    assert.deepStrictEqual(sentTypes(sockets[0]), ["x"]);
  });

  it("retries right away after the next reconnect", async function () {
    this.timeout(3000);
    await subscribe();

    await rejectResubscribe();
    sockets[0].close();
    await settle();
    assert.deepStrictEqual(sentTypes(sockets[1]), ["x"]);
    sockets[1].succeed("x");

    // The pending retry is dropped, it doesn't subscribe a second time.
    await settle(1100);
    assert.deepStrictEqual(sentTypes(sockets[1]), ["x"]);
    assert.strictEqual(conn.commands.size, 1);
  });

  it("rejects a subscription that was never established", async () => {
    const rejected = assert.rejects(
      conn.subscribeMessage(() => {}, { type: "x" }),
      { code: "unknown_command" },
    );
    await settle(0);

    await rejectResubscribe();

    await rejected;
  });
});

describe("Connection command ids after a reconnect", () => {
  it("does not unsubscribe a new subscription that reused the id", async () => {
    const socket = new FakeSocket();
    let reconnected: FakeSocket | undefined;
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => (reconnected = new FakeSocket()) as any,
    });
    const subscribing = conn.subscribeMessage(
      () => {},
      { type: "stream" },
      { resubscribe: false },
    );
    const staleId = socket.succeed("stream");
    const unsubStream = await subscribing;

    socket.close();
    await settle();
    const first = conn.subscribeMessage(() => {}, { type: "a" });
    reconnected!.succeed("a");
    await first;
    const second = conn.subscribeMessage(() => {}, { type: "b" });
    const reusedId = reconnected!.succeed("b");
    await second;
    assert.strictEqual(reusedId, staleId);

    await unsubStream();

    assert.deepStrictEqual(
      reconnected!.sent.map((m) => m.type),
      ["a", "b"],
    );
    assert.ok(conn.commands.has(reusedId));
  });

  it("does not drop a new subscription that reused the id while disconnected", async () => {
    const socket = new FakeSocket();
    const sockets: FakeSocket[] = [];
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        const created = new FakeSocket();
        sockets.push(created);
        return created as any;
      },
    });
    const subscribing = conn.subscribeMessage(
      () => {},
      { type: "stream" },
      { resubscribe: false },
    );
    const staleId = socket.succeed("stream");
    const unsubStream = await subscribing;

    socket.close();
    await settle();
    const first = conn.subscribeMessage(() => {}, { type: "a" });
    sockets[0].succeed("a");
    await first;
    const second = conn.subscribeMessage(() => {}, { type: "b" });
    assert.strictEqual(sockets[0].succeed("b"), staleId);
    await second;

    sockets[0].close();
    await unsubStream();
    await settle();

    assert.deepStrictEqual(
      sockets[1].sent.map((m) => m.type),
      ["a", "b"],
    );
  });
});

describe("Connection ready listener errors", () => {
  it("does not reconnect again when a ready listener throws", async function () {
    this.timeout(3000);
    const socket = new FakeSocket();
    let created = 0;
    const conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        created++;
        return new FakeSocket() as any;
      },
    });
    const error = new Error("listener failed");
    let thrown = false;
    conn.addEventListener("ready", () => {
      if (!thrown) {
        thrown = true;
        throw error;
      }
    });

    // The listener error should surface as an unhandled rejection.
    const rejections = await unhandledDuring(async () => {
      try {
        socket.close();
        // Well past the 1s backoff, so a retry would have run.
        await settle(1500);
      } finally {
        conn.close();
      }
    });

    assert.strictEqual(created, 1);
    assert.deepStrictEqual(rejections, [error]);
  });
});

describe("Connection event listeners", () => {
  let conn: Connection;
  let calls: string[];

  beforeEach(() => {
    conn = new Connection(new FakeSocket() as any, {
      setupRetry: 0,
      createSocket: async () => new FakeSocket() as any,
    });
    calls = [];
  });

  afterEach(() => conn.close());

  it("still calls the next listener when one removes itself", () => {
    const first = () => {
      calls.push("first");
      conn.removeEventListener("ready", first);
    };
    conn.addEventListener("ready", first);
    conn.addEventListener("ready", () => calls.push("second"));

    conn.fireEvent("ready");

    assert.deepStrictEqual(calls, ["first", "second"]);
  });

  it("does not call a listener that an earlier one removed", () => {
    const second = () => calls.push("second");
    conn.addEventListener("ready", () => {
      calls.push("first");
      conn.removeEventListener("ready", second);
    });
    conn.addEventListener("ready", second);

    conn.fireEvent("ready");

    assert.deepStrictEqual(calls, ["first"]);
  });

  it("still calls the next listener when one throws", async () => {
    const error = new Error("listener failed");
    conn.addEventListener("ready", () => {
      throw error;
    });
    conn.addEventListener("ready", () => calls.push("second"));

    const rejections = await unhandledDuring(() => conn.fireEvent("ready"));

    assert.deepStrictEqual(calls, ["second"]);
    assert.deepStrictEqual(rejections, [error]);
  });
});

describe("Connection reconnects despite", () => {
  let created: number;
  let conn: Connection;
  let socket: FakeSocket;

  beforeEach(() => {
    created = 0;
    socket = new FakeSocket();
    conn = new Connection(socket as any, {
      setupRetry: 0,
      createSocket: async () => {
        created++;
        return new FakeSocket() as any;
      },
    });
  });

  afterEach(() => conn.close());

  it("a disconnected listener that throws", async () => {
    const error = new Error("listener failed");
    conn.addEventListener("disconnected", () => {
      throw error;
    });
    const rejections = await unhandledDuring(async () => {
      socket.close();
      await settle();
    });

    assert.strictEqual(created, 1);
    assert.deepStrictEqual(rejections, [error]);
  });

  it("a suspend promise that rejects", async () => {
    const error = new Error("resume failed");
    const rejections = await unhandledDuring(async () => {
      conn.suspendReconnectUntil(Promise.reject(error));
      conn.suspend();
      await settle();
    });

    assert.strictEqual(created, 1);
    assert.strictEqual(conn.suspendReconnectPromise, undefined);
    // The rejection stays visible, it is not swallowed.
    assert.deepStrictEqual(rejections, [error]);
  });
});
