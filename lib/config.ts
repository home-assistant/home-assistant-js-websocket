import { getCollection } from "./collection";
import { HassConfig, UnsubscribeFunc } from "./types";
import { Connection } from "./connection";
import { Store } from "./store";
import { getConfig } from "./commands";

type ComponentLoadedEvent = {
  data: {
    component: string;
  };
};

function processComponentLoaded(
  state: HassConfig,
  event: ComponentLoadedEvent
): Partial<HassConfig> | null {
  if (state === undefined) return null;

  return {
    components: state.components.concat(event.data.component)
  };
}

const fetchConfig = (conn: Connection) => getConfig(conn);
const subscribeUpdates = (conn: Connection, store: Store<HassConfig>) =>
  conn.subscribeEvents(
    store.action(processComponentLoaded),
    "component_loaded"
  );

const coll = (conn: Connection) =>
  getCollection(conn, "_cnf", fetchConfig, subscribeUpdates);

export const refreshConfig = (conn: Connection): void => {
  coll(conn).refresh();
};

export const subscribeConfig = (
  conn: Connection,
  onChange: (state: HassConfig) => void
): UnsubscribeFunc => coll(conn).subscribe(onChange);
