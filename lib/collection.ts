import { Store } from "./store";
import { Connection } from "./connection";
import { UnsubscribeFunc } from "./types";

export class Collection<State> {
  public active: boolean;
  private _unsubProm?: Promise<UnsubscribeFunc>;
  private _conn: Connection;
  private _store: Store<State>;
  private _fetchCollection: (conn: Connection) => Promise<State>;
  private _subscribeUpdates: (
    conn: Connection,
    store: Store<State>
  ) => Promise<UnsubscribeFunc>;

  constructor(
    conn: Connection,
    key: string,
    fetchCollection: (conn: Connection) => Promise<State>,
    subscribeUpdates: (
      conn: Connection,
      store: Store<State>
    ) => Promise<UnsubscribeFunc>
  ) {
    this.active = false;
    this._conn = conn;
    this._fetchCollection = fetchCollection;
    this._subscribeUpdates = subscribeUpdates;
    this._store = new Store<State>();
    this.refresh = this.refresh.bind(this);

    // Store for reuse
    conn[key] = this;
  }

  async refresh() {
    try {
      this._store.setState(await this._fetchCollection(this._conn), true);
    } catch (err) {
      // Swallow errors if socket is connecting, closing or closed.
      // We will automatically call refresh again when we re-establish the connection.
      // Using conn.socket instead of WebSocket for better node support
      if (this._conn.socket.readyState == this._conn.socket.OPEN) {
        throw err;
      }
    }
  }

  subscribe(subscriber: (state: State) => void): UnsubscribeFunc {
    if (!this.active) {
      this.active = true;

      // Subscribe to changes
      this._unsubProm = this._subscribeUpdates(this._conn, this._store);

      // Fetch when connection re-established.
      this._conn.addEventListener("ready", this.refresh);

      this.refresh();
    }

    this._store.subscribe(subscriber);

    return () => {
      this._store.unsubscribe(subscriber);
      if (this._store.listeners.length === 0 && this.active) {
        this.active = false;
        // Unsubscribe from changes
        if (this._unsubProm) this._unsubProm.then(unsub => unsub());
        this._conn.removeEventListener("ready", this.refresh);
      }
    };
  }
}

export const getCollection = <State>(
  conn: Connection,
  key: string,
  fetchCollection: (conn: Connection) => Promise<State>,
  subscribeUpdates: (
    conn: Connection,
    store: Store<State>
  ) => Promise<UnsubscribeFunc>
): Collection<State> =>
  conn[key] || new Collection(conn, key, fetchCollection, subscribeUpdates);

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
