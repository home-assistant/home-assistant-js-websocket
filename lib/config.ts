import createCollection from "./collection";
import { HassConfig } from "./types";
import { Connection } from "./connection";
import Store from "./store";

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

const fetchConfig = (conn: Connection) => conn.getConfig();
const subscribeUpdates = (conn: Connection, store: Store<HassConfig>) =>
  conn.subscribeEvents(
    store.action(processComponentLoaded),
    "component_loaded"
  );

export default (conn: Connection, onChange: (state: HassConfig) => void) =>
  createCollection<HassConfig>(
    "_cnf",
    fetchConfig,
    subscribeUpdates,
    conn,
    onChange
  );
