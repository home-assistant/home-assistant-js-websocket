import { Store, createStore } from "./store";
import { Connection } from "./connection";
import { UnsubscribeFunc } from "./types";

export type Collection<State> = {
  state: State;
  refresh(): Promise<State>;
  subscribe(subscriber: (state: State) => void): UnsubscribeFunc;
};

export const getCollection = <State>(
  conn: Connection,
  key: string,
  fetchCollection: (conn: Connection) => Promise<State>,
  subscribeUpdates: (
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

  // @ts-ignore
  async function refresh(): Promise<State> {
    try {
      return store.setState(await fetchCollection(conn), true);
    } catch (err) {
      // Swallow errors if socket is connecting, closing or closed.
      // We will automatically call refresh again when we re-establish the connection.
      // Using conn.socket instead of WebSocket for better node support
      if (conn.socket.readyState == conn.socket.OPEN) {
        throw err;
      }
    }
  }

  conn[key] = {
    get state() {
      return store.state;
    },

    refresh,

    subscribe(subscriber: (state: State) => void): UnsubscribeFunc {
      if (!active) {
        active++;

        // Subscribe to changes
        unsubProm = subscribeUpdates(conn, store);

        // Fetch when connection re-established.
        conn.addEventListener("ready", refresh);

        refresh();
      }

      const unsub = store.subscribe(subscriber);

      return () => {
        unsub();
        active--;
        if (!active) {
          // Unsubscribe from changes
          if (unsubProm) unsubProm.then(unsub => unsub());
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
  subscribeUpdates: (
    conn: Connection,
    store: Store<State>
  ) => Promise<UnsubscribeFunc>,
  conn: Connection,
  onChange: (state: State) => void
): UnsubscribeFunc =>
  getCollection(conn, key, fetchCollection, subscribeUpdates).subscribe(
    onChange
  );
