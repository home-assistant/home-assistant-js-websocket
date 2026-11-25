import * as assert from "assert";

import { getCollection, type Collection } from "../dist/collection.js";
import { MockConnection, unhandledDuring } from "./util.ts";

describe("getCollection", () => {
  it("stops refreshing on ready after the last unsubscribe", async () => {
    const conn = new MockConnection();
    let fetches = 0;
    const fetchCollection = async () => {
      fetches++;
      return { fetches };
    };

    const coll = getCollection(conn, "_test", fetchCollection, undefined, {
      unsubGrace: false,
    });
    const unsub = coll.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(fetches, 1);

    unsub();
    conn.fireEvent("ready");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(fetches, 1);
  });

  it("ignores a second call of the same unsubscribe", async () => {
    const conn = new MockConnection();
    let fetches = 0;
    const fetchCollection = async () => ({ fetches: ++fetches });

    const coll = getCollection(conn, "_test", fetchCollection, undefined, {
      unsubGrace: false,
    });
    const unsub = coll.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsub();
    unsub();

    // A fresh subscriber is the first one again and has to start the collection.
    coll.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(fetches, 2);
  });

  it("does not tear down a newer subscriber on a repeated unsubscribe", async () => {
    const conn = new MockConnection();
    let fetches = 0;
    const fetchCollection = async () => ({ fetches: ++fetches });

    const coll = getCollection(conn, "_test", fetchCollection, undefined, {
      unsubGrace: false,
    });
    const unsubFirst = coll.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubFirst();

    coll.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(fetches, 2);

    // The stale unsubscribe must not count against the live subscriber.
    unsubFirst();

    assert.notStrictEqual(coll.state, undefined);
    conn.fireEvent("ready");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(fetches, 3);
  });

  it("does not call a subscriber that unsubscribed before the initial state", async () => {
    const conn = new MockConnection();
    const coll = getCollection(
      conn,
      "_test",
      async () => ({ ok: true }),
      undefined,
      {
        unsubGrace: false,
      },
    );
    const keep = coll.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Subscribe and unsubscribe synchronously, like React StrictMode does.
    const calls: unknown[] = [];
    coll.subscribe((state) => calls.push(state))();
    // The state is still there, so only cancelling the timer prevents the call.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepStrictEqual(calls, []);
    keep();
  });
});

describe("getCollection refresh rejected by Home Assistant", () => {
  const unknownCommand = {
    code: "unknown_command",
    message: "Unknown command.",
  };
  let conn: MockConnection;
  let fetches: number;
  let failing: boolean;
  let coll: Collection<{ fetches: number }>;

  beforeEach(() => {
    conn = new MockConnection();
    fetches = 0;
    failing = false;
    coll = getCollection(
      conn,
      "_test",
      async () => {
        fetches++;
        if (failing) {
          throw unknownCommand;
        }
        return { fetches };
      },
      undefined,
      { unsubGrace: false },
    );
  });

  const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  const rejectRefreshOnReady = async () => {
    failing = true;
    conn.fireEvent("ready");
    await settle();
  };

  it("retries a refresh after a reconnect until it succeeds", async function () {
    this.timeout(3000);
    const unsub = coll.subscribe(() => {});
    await settle();

    await rejectRefreshOnReady();
    assert.strictEqual(fetches, 2);
    assert.deepStrictEqual(coll.state, { fetches: 1 });

    failing = false;
    await settle(1100);
    assert.deepStrictEqual(coll.state, { fetches: 3 });
    unsub();
  });

  it("stops retrying once torn down", async function () {
    this.timeout(3000);
    const unsub = coll.subscribe(() => {});
    await settle();

    await rejectRefreshOnReady();
    unsub();
    await settle(1100);

    assert.strictEqual(fetches, 2);
  });

  it("does not retry a fetch that never succeeded", async function () {
    this.timeout(3000);
    failing = true;

    const rejections = await unhandledDuring(async () => {
      coll.subscribe(() => {});
      await settle(1100);
    });

    assert.strictEqual(fetches, 1);
    assert.deepStrictEqual(rejections, [unknownCommand]);
  });
});
