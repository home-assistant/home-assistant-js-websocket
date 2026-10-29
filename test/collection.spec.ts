import * as assert from "assert";

import { getCollection } from "../dist/collection.js";
import { MockConnection } from "./util.ts";

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
