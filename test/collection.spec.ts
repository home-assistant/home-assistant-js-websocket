import * as assert from "assert";

import { getCollection } from "../dist/collection.js";
import { MockConnection } from "./util.js";

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
});
