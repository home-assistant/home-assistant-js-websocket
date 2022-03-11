import { getCollection } from "./collection.js";
import {
  Context,
  HassEntities,
  StateChangedEvent,
  UnsubscribeFunc,
} from "./types.js";
import { Connection } from "./connection.js";
import { Store } from "./store.js";
import { getStates } from "./commands.js";
import { atLeastHaVersion } from "./util.js";

interface EntityState {
  /** state */
  s: string;
  /** attributes */
  a: { [key: string]: any };
  /** context */
  c: Context;
  /** last_changed; if set, also applies to lu */
  lc: string;
  /** last_updated */
  lu: string;
}

interface EntityDiff {
  "+"?: Partial<EntityState>;
  "-"?: Pick<EntityState, "a">;
}

interface StatesUpdates {
  add?: Record<string, EntityState>;
  removed?: string[];
  changed: Record<string, EntityDiff>;
}

function processEvent(store: Store<HassEntities>, updates: StatesUpdates) {
  const state = { ...store.state };

  if (updates.add) {
    for (const entityId in updates.add) {
      const newState = updates.add[entityId];
      state[entityId] = {
        entity_id: entityId,
        state: newState.s,
        attributes: newState.a,
        context: newState.c,
        last_changed: newState.lc,
        last_updated: newState.lu,
      };
    }
  }

  if (updates.removed) {
    for (const entityId of updates.removed) {
      delete state[entityId];
    }
  }

  if (updates.changed) {
    for (const entityId in updates.changed) {
      let entityState = state[entityId];

      if (!entityState) {
        console.warn("Received state update for unknown entity", entityId);
        continue;
      }

      entityState = { ...entityState };

      const { "+": toAdd, "-": toRemove } = updates.changed[entityId];

      const attributes =
        toAdd?.a || toRemove?.a
          ? { ...entityState.attributes }
          : entityState.attributes;

      if (toAdd) {
        if (toAdd.s) {
          entityState.state = toAdd.s;
        }
        if (toAdd.c) {
          entityState.context = toAdd.c;
        }
        if (toAdd.lc) {
          entityState.last_changed = toAdd.lc;
          entityState.last_updated = toAdd.lc;
        } else if (toAdd.lu) {
          entityState.last_updated = toAdd.lu;
        }

        if (toAdd.a) {
          Object.assign(attributes, toAdd.a);
        }
      }
      if (toRemove) {
        for (const key in toRemove.a) {
          delete attributes[key];
        }
      }

      entityState.attributes = attributes;
      state[entityId] = entityState;
    }
  }

  store.setState(state, true);
}

const subscribeUpdates = (conn: Connection, store: Store<HassEntities>) =>
  conn.subscribeMessage<StatesUpdates>((ev) => processEvent(store, ev), {
    type: "subscribe_entities",
  });

function legacyProcessEvent(
  store: Store<HassEntities>,
  event: StateChangedEvent
) {
  const state = store.state;
  if (state === undefined) return;

  const { entity_id, new_state } = event.data;
  if (new_state) {
    store.setState({ [new_state.entity_id]: new_state });
  } else {
    const newEntities = { ...state };
    delete newEntities[entity_id];
    store.setState(newEntities, true);
  }
}

async function legacyFetchEntities(conn: Connection): Promise<HassEntities> {
  const states = await getStates(conn);
  const entities: HassEntities = {};
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    entities[state.entity_id] = state;
  }
  return entities;
}

const legacySubscribeUpdates = (conn: Connection, store: Store<HassEntities>) =>
  conn.subscribeEvents<StateChangedEvent>(
    (ev) => processEvent(store, ev as StateChangedEvent),
    "state_changed"
  );

export const entitiesColl = (conn: Connection) =>
  atLeastHaVersion(conn.haVersion, 2022, 4, 0)
    ? getCollection(conn, "_ent", () => Promise.resolve({}), subscribeUpdates)
    : getCollection(conn, "_ent", legacyFetchEntities, legacySubscribeUpdates);

export const subscribeEntities = (
  conn: Connection,
  onChange: (state: HassEntities) => void
): UnsubscribeFunc => entitiesColl(conn).subscribe(onChange);
