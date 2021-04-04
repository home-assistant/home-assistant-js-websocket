import * as assert from "assert";

import { subscribeConfig } from "../dist/config";
import { MockConnection, AwaitableEvent } from "./util";

const MOCK_CONFIG = {
  hello: "bla",
  components: ["frontend"],
};

describe("subscribeConfig", () => {
  let conn: MockConnection;
  let awaitableEvent: AwaitableEvent;

  beforeEach(() => {
    conn = new MockConnection();
    conn.mockResponse("get_config", MOCK_CONFIG);
    awaitableEvent = new AwaitableEvent();
  });

  it("should load initial config", async () => {
    awaitableEvent.prime();
    subscribeConfig(conn, awaitableEvent.set);

    const config = await awaitableEvent.wait();

    assert.deepStrictEqual(config, MOCK_CONFIG);
  });

  it("should handle component loaded events", async () => {
    subscribeConfig(conn, awaitableEvent.set);

    // We need to sleep to have it process the first full load
    await 0;

    awaitableEvent.prime();

    conn.mockEvent("component_loaded", {
      data: {
        component: "api",
      },
    });

    const config = await awaitableEvent.wait();

    assert.deepEqual(config, {
      hello: "bla",
      components: ["frontend", "api"],
    });
  });
});
