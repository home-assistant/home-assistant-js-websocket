import * as assert from "assert";

import { subscribeConfig } from "../dist/config.js";
import { ERR_CONNECTION_LOST } from "../dist/errors.js";
import { error } from "../dist/messages.js";
import { MockConnection, AwaitableEvent } from "./util.ts";

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

  it("should not leave an unhandled rejection when config updates after disconnect", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) =>
      unhandledRejections.push(reason);
    const sendMessagePromise = conn.sendMessagePromise.bind(conn);
    conn.sendMessagePromise = async (message: any) => {
      if (conn.closeRequested) {
        throw error(ERR_CONNECTION_LOST, "Connection lost");
      }
      return sendMessagePromise(message);
    };

    process.on("unhandledRejection", onUnhandledRejection);

    try {
      awaitableEvent.prime();
      subscribeConfig(conn, awaitableEvent.set);
      await awaitableEvent.wait();

      conn.close();
      conn.mockEvent("core_config_updated", {});

      await new Promise((resolve) => setImmediate(resolve));

      assert.deepStrictEqual(unhandledRejections, []);
    } finally {
      conn.sendMessagePromise = sendMessagePromise;
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
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
