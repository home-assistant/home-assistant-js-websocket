import * as assert from "assert";

import { subscribeServices } from "../dist/services";
import { MockConnection, AwaitableEvent } from "./util";

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
