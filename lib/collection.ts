import { Store, createStore } from "./store.js";
import { Connection } from "./connection.js";
import { isConnectionLost } from "./errors.js";
import { UnsubscribeFunc } from "./types.js";
import { isErrorResult, retryDelay } from "./util.js";

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
    store: Store<State>,
  ) => Promise<UnsubscribeFunc>,
  options: { unsubGrace: boolean } = { unsubGrace: true },
): Collection<State> => {
  // @ts-ignore
  if (conn[key]) {
    // @ts-ignore
    return conn[key];
  }

  let active = 0;
  let unsubProm: Promise<UnsubscribeFunc>;
  let unsubTimer: number | undefined;
  let refreshRetryTimer: number | undefined;
  let store = createStore<State>();

  const refresh = (): Promise<void> => {
    if (!fetchCollection) {
      throw new Error("Collection does not support refresh");
    }

    return fetchCollection(conn).then((state) => store.setState(state, true));
  };

  const refreshSwallow = (attempt = 0): Promise<void> => {
    clearTimeout(refreshRetryTimer);
    return refresh().catch((err: unknown) => {
      // Swallow errors if socket is connecting, closing or closed.
      // We will automatically call refresh again when we re-establish the connection.
      if (!conn.connected) {
        return;
      }
      // Home Assistant accepts connections while it is starting, before the
      // integration behind the collection has loaded. Retry what worked before.
      if (store.state === undefined || !isErrorResult(err)) {
        throw err;
      }
      refreshRetryTimer = setTimeout(
        () => refreshSwallow(attempt + 1),
        retryDelay(attempt),
      );
    });
  };

  // Listeners get the connection as first argument, not an attempt.
  const refreshOnReady = () => refreshSwallow();

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
      // The subscription is gone when the connection is closed for good.
      unsubProm.catch((err: unknown) => {
        if (!isConnectionLost(err)) {
          throw err;
        }
      });
    }

    if (fetchCollection) {
      // Fetch when connection re-established.
      conn.addEventListener("ready", refreshOnReady);
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
      unsubProm.then(
        (unsub) => {
          unsub();
        },
        () => undefined,
      );
    clearTimeout(refreshRetryTimer);
    store.clearState();
    conn.removeEventListener("ready", refreshOnReady);
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

  // @ts-ignore
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

      let initialTimer: number | undefined;

      if (store.state !== undefined) {
        // Don't call it right away so that caller has time
        // to initialize all the things.
        // Unsubscribing clears the timer, and teardown needs this subscriber
        // gone first, so the state is still there when it fires.
        initialTimer = setTimeout(() => {
          initialTimer = undefined;
          subscriber(store.state!);
        }, 0);
      }

      let unsubscribed = false;

      return () => {
        // Cleanup code tends to run twice, don't let that drive active negative.
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        clearTimeout(initialTimer);
        unsub();
        active--;

        if (DEBUG) {
          console.log(`Unsubscribe for ${key}. Active subscribers: ${active}`);
        }

        if (!active) {
          options.unsubGrace
            ? scheduleTeardownUpdateSubscription()
            : teardownUpdateSubscription();
        }
      };
    },
  };

  // @ts-ignore
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
  onChange: (state: State) => void,
): UnsubscribeFunc =>
  getCollection(conn, key, fetchCollection, subscribeUpdates).subscribe(
    onChange,
  );
