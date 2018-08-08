import { createStore } from './store';

let collectionID = 0;

// fetchCollection returns promise that resolves to current value of collection.
// subscribeUpdates(connection, store) returns promise that resolves
// to an unsubscription function.

export default function createCollection(fetchCollection, subscribeUpdates) {
  const key = `_collection_${collectionID++}`;

  return function (conn, onChange) {
    if (key in conn) {
      return conn[key](onChange);
    }

    let unsubProm;

    const store = createStore(() => {
      unsubProm.then(unsub => unsub());
      // eslint-disable-next-line
      conn.removeEventListener('ready', refresh);
      delete conn[key];
    });

    conn[key] = store.subscribe;

    // Subscribe to changes
    unsubProm = subscribeUpdates(conn, store);

    async function refresh() {
      store.setState(await fetchCollection(conn), true);
    }

    // Fetch when connection re-established.
    conn.addEventListener('ready', refresh);

    refresh();

    return store.subscribe(onChange);
  };
}
