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
  c: Context | string;
  /** last_changed; if set, also applies to lu */
  lc: number;
  /** last_updated */
  lu: number;
}

interface EntityStateRemove {
  /** attributes */
  a: string[];
}

interface EntityDiff {
  /** additions */
  "+"?: Partial<EntityState>;
  /** subtractions */
  "-"?: EntityStateRemove;
}

interface StatesUpdates {
  /** add */
  a?: Record<string, EntityState>;
  /** remove */
  r?: string[]; // remove
  /** change */
  c: Record<string, EntityDiff>;
}

function processEvent(store: Store<HassEntities>, updates: StatesUpdates) {
  const state = { ...store.state };

  if (updates.a) {
    for (const entityId in updates.a) {
      const newState = updates.a[entityId];
      let last_changed = new Date(newState.lc * 1000).toISOString();
      state[entityId] = {
        entity_id: entityId,
        state: newState.s,
        attributes: newState.a,
        context:
          typeof newState.c === "string"
            ? { id: newState.c, parent_id: null, user_id: null }
            : newState.c,
        last_changed: last_changed,
        last_updated: newState.lu
          ? new Date(newState.lu * 1000).toISOString()
          : last_changed,
      };
    }
  }

  if (updates.r) {
    for (const entityId of updates.r) {
      delete state[entityId];
    }
  }

  if (updates.c) {
    for (const entityId in updates.c) {
      let entityState = state[entityId];

      if (!entityState) {
        console.warn("Received state update for unknown entity", entityId);
        continue;
      }

      entityState = { ...entityState };

      const { "+": toAdd, "-": toRemove } = updates.c[entityId];
      const attributesChanged = toAdd?.a || toRemove?.a;
      const attributes = attributesChanged
        ? { ...entityState.attributes }
        : entityState.attributes;

      if (toAdd) {
        if (toAdd.s !== undefined) {
          entityState.state = toAdd.s;
        }
        if (toAdd.c) {
          if (typeof toAdd.c === "string") {
            entityState.context = { ...entityState.context, id: toAdd.c };
          } else {
            entityState.context = { ...entityState.context, ...toAdd.c };
          }
        }
        if (toAdd.lc) {
          entityState.last_updated = entityState.last_changed = new Date(
            toAdd.lc * 1000,
          ).toISOString();
        } else if (toAdd.lu) {
          entityState.last_updated = new Date(toAdd.lu * 1000).toISOString();
        }
        if (toAdd.a) {
          Object.assign(attributes, toAdd.a);
        }
      }
      if (toRemove?.a) {
        for (const key of toRemove.a) {
          delete attributes[key];
        }
      }
      if (attributesChanged) {
        entityState.attributes = attributes;
      }
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
  event: StateChangedEvent,
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
    (ev) => legacyProcessEvent(store, ev as StateChangedEvent),
    "state_changed",
  );

export const entitiesColl = (conn: Connection) =>
  atLeastHaVersion(conn.haVersion, 2022, 4, 0)
    ? getCollection(conn, "_ent", undefined, subscribeUpdates)
    : getCollection(conn, "_ent", legacyFetchEntities, legacySubscribeUpdates);

export const subscribeEntities = (
  conn: Connection,
  onChange: (state: HassEntities) => void,
): UnsubscribeFunc => entitiesColl(conn).subscribe(onChange);
