import { getCollection } from "./collection.js";
import { HassConfig, UnsubscribeFunc } from "./types.js";
import { Connection } from "./connection.js";
import { Store } from "./store.js";
import { getConfig } from "./commands.js";

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
    components: state.components.concat(event.data.component),
  };
}

const fetchConfig = (conn: Connection) => getConfig(conn);
const subscribeUpdates = (conn: Connection, store: Store<HassConfig>) =>
  Promise.all([
    conn.subscribeEvents(
      store.action(processComponentLoaded),
      "component_loaded"
    ),
    conn.subscribeEvents(
      () => fetchConfig(conn).then((config) => store.setState(config, true)),
      "core_config_updated"
    ),
  ]).then((unsubs) => () => unsubs.forEach((unsub) => unsub()));

const configColl = (conn: Connection) =>
  getCollection(conn, "_cnf", fetchConfig, subscribeUpdates);

export const subscribeConfig = (
  conn: Connection,
  onChange: (state: HassConfig) => void
): UnsubscribeFunc => configColl(conn).subscribe(onChange);

export const STATE_NOT_RUNNING = "NOT_RUNNING";
export const STATE_STARTING = "STARTING";
export const STATE_RUNNING = "RUNNING";
export const STATE_STOPPING = "STOPPING";
export const STATE_FINAL_WRITE = "FINAL_WRITE";
