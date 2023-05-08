import { Store, createStore } from "./store.js";
import { Connection } from "./connection.js";
import { UnsubscribeFunc } from "./types.js";

export type Collection<State> = {
  state: State;
  refresh(): Promise<void>;
  subscribe(subscriber: (state: State) => void): UnsubscribeFunc;
};

// Time to wait to unsubscribe from updates after last subscriber unsubscribes
const UNSUB_GRACE_PERIOD = 5000; // 5 seconds
const DEBUG = false;

/**
 *
 * @param conn connection
 * @param key the key to store it on the connection. Must be unique for each collection.
 * @param fetchCollection fetch the current state. If undefined assumes subscribeUpdates receives current state
 * @param subscribeUpdates subscribe to updates on the current state
 * @returns
 */
export const getCollection = <State>(
  conn: Connection,
  key: string,
  fetchCollection: ((conn: Connection) => Promise<State>) | undefined,
  subscribeUpdates?: (
    conn: Connection,
    store: Store<State>
  ) => Promise<UnsubscribeFunc>,
  unsubGrace = true
): Collection<State> => {
  if (conn[key]) {
    return conn[key];
  }

  let active = 0;
  let unsubProm: Promise<UnsubscribeFunc>;
  let unsubTimer: number | undefined;
  let store = createStore<State>();

  const refresh = (): Promise<void> => {
    if (!fetchCollection) {
      throw new Error("Collection does not support refresh");
    }

    return fetchCollection(conn).then((state) => store.setState(state, true));
  };

  const refreshSwallow = () =>
    refresh().catch((err: unknown) => {
      // Swallow errors if socket is connecting, closing or closed.
      // We will automatically call refresh again when we re-establish the connection.
      if (conn.connected) {
        throw err;
      }
    });

  const setupUpdateSubscription = () => {
    if (unsubTimer !== undefined) {
      if (DEBUG) {
        console.log(`Prevented unsubscribe for ${key}`);
      }
      clearTimeout(unsubTimer);
      unsubTimer = undefined;
      return;
    }

    if (DEBUG) {
      console.log(`Subscribing to ${key}`);
    }

    if (subscribeUpdates) {
      unsubProm = subscribeUpdates(conn, store);
    }

    if (fetchCollection) {
      // Fetch when connection re-established.
      conn.addEventListener("ready", refreshSwallow);
      refreshSwallow();
    }

    conn.addEventListener("disconnected", handleDisconnect);
  };

  const teardownUpdateSubscription = () => {
    if (DEBUG) {
      console.log(`Unsubscribing from ${key}`);
    }
    unsubTimer = undefined;

    // Unsubscribe from changes
    if (unsubProm)
      unsubProm.then((unsub) => {
        unsub();
      });
    store.clearState();
    conn.removeEventListener("ready", refresh);
    conn.removeEventListener("disconnected", handleDisconnect);
  };

  const scheduleTeardownUpdateSubscription = () => {
    if (DEBUG) {
      console.log(`Scheduling unsubscribing from ${key}`);
    }
    unsubTimer = setTimeout(teardownUpdateSubscription, UNSUB_GRACE_PERIOD);
  };

  const handleDisconnect = () => {
    // If we're going to unsubscribe and then lose connection,
    // just unsubscribe immediately.
    if (unsubTimer) {
      clearTimeout(unsubTimer);
      teardownUpdateSubscription();
    }
  };

  conn[key] = {
    get state() {
      return store.state;
    },

    refresh,

    subscribe(subscriber: (state: State) => void): UnsubscribeFunc {
      active++;

      if (DEBUG) {
        console.log(`New subscriber for ${key}. Active subscribers: ${active}`);
      }

      // If this was the first subscriber, attach collection
      if (active === 1) {
        setupUpdateSubscription();
      }

      const unsub = store.subscribe(subscriber);

      if (store.state !== undefined) {
        // Don't call it right away so that caller has time
        // to initialize all the things.
        setTimeout(() => subscriber(store.state!), 0);
      }

      return () => {
        unsub();
        active--;

        if (DEBUG) {
          console.log(`Unsubscribe for ${key}. Active subscribers: ${active}`);
        }

        if (!active) {
          unsubGrace
            ? scheduleTeardownUpdateSubscription()
            : teardownUpdateSubscription();
        }
      };
    },
  };

  return conn[key];
};

// Legacy name. It gets a collection and subscribes.
export const createCollection = <State>(
  key: string,
  fetchCollection: (conn: Connection) => Promise<State>,
  subscribeUpdates:
    | ((conn: Connection, store: Store<State>) => Promise<UnsubscribeFunc>)
    | undefined,
  conn: Connection,
  onChange: (state: State) => void
): UnsubscribeFunc =>
  getCollection(conn, key, fetchCollection, subscribeUpdates).subscribe(
    onChange
  );
