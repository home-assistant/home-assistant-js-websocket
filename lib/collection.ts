import { Store, createStore } from "./store.js";
import { Connection } from "./connection.js";
import { UnsubscribeFunc } from "./types.js";

export type Collection<State> = {
  state: State;
  refresh(): Promise<void>;
  subscribe(subscriber: (state: State) => void): UnsubscribeFunc;
};

export const getCollection = <State>(
  conn: Connection,
  key: string,
  fetchCollection: (conn: Connection) => Promise<State>,
  subscribeUpdates?: (
    conn: Connection,
    store: Store<State>
  ) => Promise<UnsubscribeFunc>
): Collection<State> => {
  if (conn[key]) {
    return conn[key];
  }

  let active = 0;
  let unsubProm: Promise<UnsubscribeFunc>;
  let store = createStore<State>();

  const refresh = () =>
    fetchCollection(conn).then(state => store.setState(state, true));

  const refreshSwallow = () =>
    refresh().catch((err: unknown) => {
      // Swallow errors if socket is connecting, closing or closed.
      // We will automatically call refresh again when we re-establish the connection.
      // Using conn.socket.OPEN instead of WebSocket for better node support
      if (conn.socket.readyState == conn.socket.OPEN) {
        throw err;
      }
    });

  conn[key] = {
    get state() {
      return store.state;
    },

    refresh,

    subscribe(subscriber: (state: State) => void): UnsubscribeFunc {
      active++;

      // If this was the first subscriber, attach collection
      if (active === 1) {
        if (subscribeUpdates) {
          unsubProm = subscribeUpdates(conn, store);
        }

        // Fetch when connection re-established.
        conn.addEventListener("ready", refreshSwallow);

        refreshSwallow();
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
        if (!active) {
          // Unsubscribe from changes
          if (unsubProm)
            unsubProm.then(unsub => {
              unsub();
            });
          conn.removeEventListener("ready", refresh);
        }
      };
    }
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
