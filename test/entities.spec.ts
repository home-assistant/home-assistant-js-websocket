import * as assert from "assert";

import { subscribeEntities } from "../dist/entities.js";
import { MockConnection, AwaitableEvent } from "./util.js";

const MOCK_LIGHT = {
  entity_id: "light.kitchen",
  state: "on",
};

const MOCK_SWITCH = {
  entity_id: "switch.ac",
  state: "off",
};

const MOCK_ENTITIES = [MOCK_LIGHT, MOCK_SWITCH];
const MOCK_CONTEXT = {
  id: "abc123",
  parent_id: null,
  user_id: null,
};

const modernEntity = (entity_id: string, state: string, lc: number) => ({
  s: state,
  a: {},
  c: MOCK_CONTEXT,
  lc,
  lu: lc,
});

const modernState = (entity_id: string, state: string, lc: number) => ({
  entity_id,
  state,
  attributes: {},
  context: MOCK_CONTEXT,
  last_changed: new Date(lc * 1000).toISOString(),
  last_updated: new Date(lc * 1000).toISOString(),
});

describe("subscribeEntities legacy", () => {
  let conn: MockConnection;
  let awaitableEvent: AwaitableEvent;

  beforeEach(() => {
    conn = new MockConnection();
    conn.haVersion = "2022.3.0";
    conn.mockResponse("get_states", MOCK_ENTITIES);
    awaitableEvent = new AwaitableEvent();
  });

  it("should load initial entities", async () => {
    awaitableEvent.prime();
    subscribeEntities(conn, awaitableEvent.set);

    const entities = await awaitableEvent.wait();
    assert.deepStrictEqual(entities, {
      [MOCK_LIGHT.entity_id]: MOCK_LIGHT,
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH,
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
          state: "off",
        },
      },
    });

    const entities = await awaitableEvent.wait();

    assert.deepEqual(entities, {
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH,
      "light.kitchen": {
        entity_id: "light.kitchen",
        state: "off",
      },
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
          state: "off",
        },
      },
    });

    const entities = await awaitableEvent.wait();

    assert.deepEqual(entities, {
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH,
      [MOCK_LIGHT.entity_id]: MOCK_LIGHT,
      "light.living_room": {
        entity_id: "light.living_room",
        state: "off",
      },
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
        new_state: null,
      },
    });

    const entities = await awaitableEvent.wait();

    assert.deepEqual(entities, {
      [MOCK_SWITCH.entity_id]: MOCK_SWITCH,
    });
  });
});

describe("subscribeEntities", () => {
  let conn: MockConnection;
  let awaitableEvent: AwaitableEvent;

  beforeEach(() => {
    conn = new MockConnection();
    conn.haVersion = "2022.4.0";
    awaitableEvent = new AwaitableEvent();
  });

  it("should load initial entities", async () => {
    awaitableEvent.prime();
    subscribeEntities(conn, awaitableEvent.set);

    conn.mockEvent("subscribe_entities", {
      a: {
        [MOCK_LIGHT.entity_id]: modernEntity(MOCK_LIGHT.entity_id, "on", 1),
        [MOCK_SWITCH.entity_id]: modernEntity(MOCK_SWITCH.entity_id, "off", 2),
      },
      c: {},
    });

    const entities = await awaitableEvent.wait();

    assert.deepStrictEqual(entities, {
      [MOCK_LIGHT.entity_id]: modernState(MOCK_LIGHT.entity_id, "on", 1),
      [MOCK_SWITCH.entity_id]: modernState(MOCK_SWITCH.entity_id, "off", 2),
    });
  });

  it("should replace state from full snapshot after reconnect", async () => {
    subscribeEntities(conn, awaitableEvent.set);

    awaitableEvent.prime();
    conn.mockEvent("subscribe_entities", {
      a: {
        [MOCK_LIGHT.entity_id]: modernEntity(MOCK_LIGHT.entity_id, "on", 1),
        "sensor.ghost_probe": modernEntity("sensor.ghost_probe", "1", 2),
      },
      c: {},
    });

    await awaitableEvent.wait();

    awaitableEvent.prime();
    conn.fireEvent("ready");
    conn.mockEvent("subscribe_entities", {
      a: {
        [MOCK_LIGHT.entity_id]: modernEntity(MOCK_LIGHT.entity_id, "on", 3),
      },
      c: {},
    });

    const entities = await awaitableEvent.wait();

    assert.deepStrictEqual(entities, {
      [MOCK_LIGHT.entity_id]: modernState(MOCK_LIGHT.entity_id, "on", 3),
    });
  });
});
