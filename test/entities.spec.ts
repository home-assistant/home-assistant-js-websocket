import * as assert from "assert";

import { processEvent, subscribeEntities } from "../dist/entities.js";
import { createStore } from "../dist/store.js";
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

describe("subscribeEntities incremental updates", () => {
  it("preserves unchanged entities while applying adds, changes, and removals", () => {
    const unchanged = {
      entity_id: "sensor.unchanged",
      state: "1",
      attributes: { unit_of_measurement: "kW" },
      context: { id: "unchanged" },
      last_changed: "2026-01-01T00:00:00.000Z",
      last_updated: "2026-01-01T00:00:00.000Z",
    };
    const changed = {
      entity_id: "light.kitchen",
      state: "off",
      attributes: { brightness: 10 },
      context: { id: "changed" },
      last_changed: "2026-01-01T00:00:00.000Z",
      last_updated: "2026-01-01T00:00:00.000Z",
    };
    const removed = {
      entity_id: "switch.garage",
      state: "on",
      attributes: {},
      context: { id: "removed" },
      last_changed: "2026-01-01T00:00:00.000Z",
      last_updated: "2026-01-01T00:00:00.000Z",
    };
    const store = createStore({
      [unchanged.entity_id]: unchanged,
      [changed.entity_id]: changed,
      [removed.entity_id]: removed,
    });

    processEvent(store, {
      a: {
        "binary_sensor.new": {
          s: "on",
          a: {},
          c: "new",
          lc: 1767225600,
          lu: 1767225600,
        },
      },
      r: [removed.entity_id],
      c: {
        [changed.entity_id]: {
          "+": { s: "on", a: { brightness: 100 } },
          "-": { a: ["brightness"] },
        },
      },
    });

    assert.deepStrictEqual(store.state, {
      [unchanged.entity_id]: unchanged,
      [changed.entity_id]: {
        ...changed,
        state: "on",
        attributes: {},
      },
      "binary_sensor.new": {
        entity_id: "binary_sensor.new",
        state: "on",
        attributes: {},
        context: { id: "new", parent_id: null, user_id: null },
        last_changed: "2026-01-01T00:00:00.000Z",
        last_updated: "2026-01-01T00:00:00.000Z",
      },
    });
  });
});
