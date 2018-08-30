import assert from "assert";

import { subscribeEntities } from "../lib/entities";
import { mockConnection, createAwaitableEvent } from "./util";

const MOCK_LIGHT = {
  entity_id: "light.kitchen",
  state: "on"
};

const MOCK_SWITCH = {
  entity_id: "switch.ac",
  state: "off"
};

const MOCK_ENTITIES = [MOCK_LIGHT, MOCK_SWITCH];

describe("subscribeEntities", () => {
  let conn;
  let awaitableEvent;

  beforeEach(() => {
    conn = mockConnection();
    conn.getStates = async () => MOCK_ENTITIES;
    awaitableEvent = createAwaitableEvent();
  });

  it("should load initial entities", async () => {
    awaitableEvent.prime();
    subscribeEntities(conn, awaitableEvent.set);

    const entities = await awaitableEvent.wait();
    assert.deepStrictEqual(entities, {
      [MOCK_LIGHT.entity_id]: MOCK_LIGHT,
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH
    });
  });

  it("should handle state changed with updated state", async () => {
    subscribeEntities(conn, awaitableEvent.set);

    await 0;
    await 0;
    await 0;

    awaitableEvent.prime();

    conn.mockEvent("state_changed", {
      data: {
        entity_id: "light.kitchen",
        new_state: {
          entity_id: "light.kitchen",
          state: "off"
        }
      }
    });

    const entities = await awaitableEvent.wait();

    assert.deepEqual(entities, {
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH,
      "light.kitchen": {
        entity_id: "light.kitchen",
        state: "off"
      }
    });
  });

  it("should handle state changed with new state", async () => {
    subscribeEntities(conn, awaitableEvent.set);

    await 0;
    await 0;
    await 0;

    awaitableEvent.prime();

    conn.mockEvent("state_changed", {
      data: {
        entity_id: "light.living_room",
        new_state: {
          entity_id: "light.living_room",
          state: "off"
        }
      }
    });

    const entities = await awaitableEvent.wait();

    assert.deepEqual(entities, {
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH,
      [MOCK_LIGHT.entity_id]: MOCK_LIGHT,
      "light.living_room": {
        entity_id: "light.living_room",
        state: "off"
      }
    });
  });

  it("should handle state changed with removed state", async () => {
    subscribeEntities(conn, awaitableEvent.set);

    await 0;
    await 0;
    await 0;

    awaitableEvent.prime();

    conn.mockEvent("state_changed", {
      data: {
        entity_id: "light.kitchen",
        new_state: null
      }
    });

    const entities = await awaitableEvent.wait();

    assert.deepEqual(entities, {
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH
    });
  });
});
