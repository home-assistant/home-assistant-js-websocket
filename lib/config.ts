import createCollection from "./collection";
import { HassConfig } from "./types";
import { Connection } from "./connection";

type ComponentLoadedEvent = {
  data: {
    component: string;
  };
};

function processComponentLoaded(
  state: HassConfig,
  event: ComponentLoadedEvent
): Partial<HassConfig> {
  if (state === undefined) return null;

  return {
    components: state.components.concat(event.data.component)
  };
}

const fetchConfig = conn => conn.getConfig();
const subscribeUpdates = (conn, store) =>
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
