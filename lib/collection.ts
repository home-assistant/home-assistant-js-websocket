import { Store } from "./store";
import { Connection } from "./connection";
import { UnsubscribeFunc } from "./types";

// fetchCollection returns promise that resolves to current value of collection.
// subscribeUpdates(connection, store) returns promise that resolves
// to an unsubscription function.

export function createCollection<State>(
  key: string,
  fetchCollection: (conn: Connection) => Promise<State>,
  subscribeUpdates: (
    conn: Connection,
    store: Store<State>
  ) => Promise<UnsubscribeFunc>,
  conn: Connection,
  onChange: (state: State) => void
): UnsubscribeFunc {
  if (key in conn) {
    return conn[key](onChange);
  }

  let unsubProm: Promise<UnsubscribeFunc>;

  const store = new Store<State>(() => {
    if (unsubProm) unsubProm.then(unsub => unsub());
    conn.removeEventListener("ready", refresh);
    delete conn[key];
  });

  conn[key] = (onChange: (state: State) => void) => store.subscribe(onChange);

  // Subscribe to changes
  if (subscribeUpdates) {
    unsubProm = subscribeUpdates(conn, store);
  }

  const refresh = async () => {
    try {
      store.setState(await fetchCollection(conn), true);
    } catch (err) {
      // Swallow errors if socket is connecting, closing or closed.
      // We will automatically call refresh again when we re-establish the connection.
      // Using conn.socket instead of WebSocket for better node support
      if (conn.socket.readyState == conn.socket.OPEN) {
        throw err;
      }
    }
  };

  // Fetch when connection re-established.
  conn.addEventListener("ready", refresh);

  refresh();

  return store.subscribe(onChange);
}
