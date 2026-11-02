import * as assert from "assert";

import { subscribeServices, servicesColl } from "../dist/services.js";
import { ERR_CONNECTION_LOST } from "../dist/errors.js";
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

  it("should keep known metadata when an existing service registers again", async () => {
    subscribeServices(conn, awaitableEvent.set);
    await 0;

    conn.mockEvent("service_registered", {
      data: {
        domain: "light",
        service: "turn_on",
      },
    });

    assert.deepStrictEqual(
      servicesColl(conn).state.light.turn_on,
      MOCK_SERVICES.light.turn_on,
    );
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

// Captures timers so the fetch debounce can be driven from a test. Mocha
// keeps its own references to the real timer functions.
class FakeTimers {
  private _timers = new Map<number, { fn: () => void; ms: number }>();
  private _nextId = 0;
  private _real = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  install() {
    (globalThis as any).setTimeout = (fn: () => void, ms = 0) => {
      this._timers.set(++this._nextId, { fn, ms });
      return this._nextId;
    };
    (globalThis as any).clearTimeout = (id: number) => {
      this._timers.delete(id);
    };
  }

  restore() {
    globalThis.setTimeout = this._real.setTimeout;
    globalThis.clearTimeout = this._real.clearTimeout;
  }

  fire(ms: number) {
    for (const [id, timer] of [...this._timers]) {
      if (timer.ms === ms) {
        this._timers.delete(id);
        timer.fn();
      }
    }
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await 0;
};

const countFetches = (conn: MockConnection) => {
  let count = 0;
  const original = conn.sendMessagePromise.bind(conn);
  conn.sendMessagePromise = async (message: any) => {
    if (message.type === "get_services") count++;
    return original(message);
  };
  return () => count;
};

describe("subscribeServices fetch debounce", () => {
  const timers = new FakeTimers();
  const registration = { data: { domain: "switch", service: "turn_on" } };

  beforeEach(() => timers.install());
  afterEach(() => timers.restore());

  it("fetches again for every connection that saw a registration", async () => {
    const conn = new MockConnection();
    const other = new MockConnection();
    conn.mockResponse("get_services", MOCK_SERVICES);
    other.mockResponse("get_services", MOCK_SERVICES);
    const fetches = countFetches(conn);
    const otherFetches = countFetches(other);
    subscribeServices(conn, () => {});
    subscribeServices(other, () => {});
    await flush();

    conn.mockEvent("service_registered", registration);
    other.mockEvent("service_registered", registration);
    timers.fire(5000);
    await flush();

    assert.strictEqual(fetches(), 2);
    assert.strictEqual(otherFetches(), 2);
  });

  // Collects rejections nobody handled while fn runs.
  const unhandledDuring = async (fn: () => Promise<void>) => {
    const mochaHandlers = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const rejections: unknown[] = [];
    process.on("unhandledRejection", (reason) => rejections.push(reason));
    try {
      await fn();
      // Unhandled rejections are reported after the microtask queue drains,
      // and setTimeout is faked here, so wait a macrotask with setImmediate.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.removeAllListeners("unhandledRejection");
      mochaHandlers.forEach((h) => process.on("unhandledRejection", h));
    }
    return rejections;
  };

  const failNextFetch = (conn: MockConnection, error: unknown) => {
    const original = conn.sendMessagePromise.bind(conn);
    conn.sendMessagePromise = async (message: any) => {
      if (message.type === "get_services") throw error;
      return original(message);
    };
  };

  it("ignores a debounced fetch that fails because the connection was lost", async () => {
    const conn = new MockConnection();
    conn.mockResponse("get_services", MOCK_SERVICES);
    subscribeServices(conn, () => {});
    await flush();

    const rejections = await unhandledDuring(async () => {
      conn.mockEvent("service_registered", registration);
      failNextFetch(conn, {
        type: "result",
        success: false,
        error: { code: ERR_CONNECTION_LOST, message: "Connection lost" },
      });
      timers.fire(5000);
      await flush();
    });

    assert.deepStrictEqual(rejections, []);
  });

  it("still surfaces a debounced fetch that fails for another reason", async () => {
    const conn = new MockConnection();
    conn.mockResponse("get_services", MOCK_SERVICES);
    subscribeServices(conn, () => {});
    await flush();
    const error = new Error("backend error");

    const rejections = await unhandledDuring(async () => {
      conn.mockEvent("service_registered", registration);
      failNextFetch(conn, error);
      timers.fire(5000);
      await flush();
    });

    assert.strictEqual(rejections.length, 1);
    assert.strictEqual(rejections[0], error);
  });

  it("cancels a pending fetch when the collection is torn down", async () => {
    const conn = new MockConnection();
    conn.mockResponse("get_services", MOCK_SERVICES);
    const fetches = countFetches(conn);
    const unsub = subscribeServices(conn, () => {});
    await flush();

    conn.mockEvent("service_registered", registration);
    unsub();
    // Losing the connection during the grace period tears down right away.
    conn.fireEvent("disconnected");
    await flush();
    timers.fire(5000);
    await flush();

    assert.strictEqual(fetches(), 1);
  });
});
