import * as assert from "assert";

import { subscribeServices } from "../dist/services.js";
import { MockConnection, AwaitableEvent } from "./util.ts";

const MOCK_SERVICES = {
  light: {
    turn_on: {
      description: "Turn a light on",
      fields: {
        entity_id: {
          description: "Entity ID to turn on",
          example: "light.kitchen",
        },
      },
    },
  },
};

describe("subscribeServices", () => {
  let conn: MockConnection;
  let awaitableEvent: AwaitableEvent;

  beforeEach(() => {
    conn = new MockConnection();
    conn.mockResponse("get_services", MOCK_SERVICES);
    awaitableEvent = new AwaitableEvent();
  });

  it("should load initial services", async () => {
    awaitableEvent.prime();
    subscribeServices(conn, awaitableEvent.set);

    const services = await awaitableEvent.wait();
    assert.deepStrictEqual(services, MOCK_SERVICES);
  });

  it("should not leave an unhandled rejection when the connection closes during the debounce", async function () {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) =>
      unhandledRejections.push(reason);
    const sendMessagePromise = conn.sendMessagePromise.bind(conn);
    const timers = new FakeTimers();
    conn.sendMessagePromise = async (message: any) => {
      if (conn.closeRequested) {
        throw new Error("Connection lost");
      }
      return sendMessagePromise(message);
    };

    process.on("unhandledRejection", onUnhandledRejection);

    try {
      timers.install();
      awaitableEvent.prime();
      subscribeServices(conn, awaitableEvent.set);
      await awaitableEvent.wait();

      conn.mockEvent("service_registered", {
        data: {
          domain: "light",
          service: "toggle",
        },
      });
      conn.close();
      conn.socket = undefined;
      timers.fire(5000);
      conn.socket = { OPEN: 1, readyState: 1 } as any;

      await new Promise((resolve) => setImmediate(resolve));

      assert.deepStrictEqual(unhandledRejections, []);
    } finally {
      conn.sendMessagePromise = sendMessagePromise;
      timers.restore();
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
  });

  it("should handle service registered events for existing domains", async () => {
    subscribeServices(conn, awaitableEvent.set);

    await 0;

    awaitableEvent.prime();

    conn.mockEvent("service_registered", {
      data: {
        domain: "light",
        service: "toggle",
      },
    });

    const services = await awaitableEvent.wait();

    assert.deepEqual(services, {
      light: {
        turn_on: {
          description: "Turn a light on",
          fields: {
            entity_id: {
              description: "Entity ID to turn on",
              example: "light.kitchen",
            },
          },
        },
        toggle: {
          description: "",
          fields: {},
        },
      },
    });
  });

  it("should handle service registered events for new domains", async () => {
    subscribeServices(conn, awaitableEvent.set);

    // We need to sleep to have it process the first full load
    await 0;
    awaitableEvent.prime();

    conn.mockEvent("service_registered", {
      data: {
        domain: "switch",
        service: "turn_on",
      },
    });

    const services = await awaitableEvent.wait();

    assert.deepEqual(services, {
      light: {
        turn_on: {
          description: "Turn a light on",
          fields: {
            entity_id: {
              description: "Entity ID to turn on",
              example: "light.kitchen",
            },
          },
        },
      },
      switch: {
        turn_on: {
          description: "",
          fields: {},
        },
      },
    });
  });

  it("should handle service removed events for existing services", async () => {
    subscribeServices(conn, awaitableEvent.set);

    // We need to sleep to have it process the first full load
    await 0;
    awaitableEvent.prime();

    conn.mockEvent("service_removed", {
      data: {
        domain: "light",
        service: "turn_on",
      },
    });

    const services = await awaitableEvent.wait();

    assert.deepEqual(services, {
      light: {},
    });
  });
});

class FakeTimers {
  private timers = new Map<number, { callback: () => void; delay: number }>();
  private nextId = 0;
  private realSetTimeout = globalThis.setTimeout;
  private realClearTimeout = globalThis.clearTimeout;

  install() {
    (globalThis as any).setTimeout = (callback: () => void, delay = 0) => {
      const id = ++this.nextId;
      this.timers.set(id, { callback, delay });
      return id;
    };
    (globalThis as any).clearTimeout = (id: number) => {
      this.timers.delete(id);
    };
  }

  restore() {
    globalThis.setTimeout = this.realSetTimeout;
    globalThis.clearTimeout = this.realClearTimeout;
  }

  fire(delay: number) {
    for (const [id, timer] of [...this.timers]) {
      if (timer.delay === delay) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}
