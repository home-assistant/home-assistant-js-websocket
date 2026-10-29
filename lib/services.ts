import { getCollection } from "./collection.js";
import { HassServices, HassDomainServices, UnsubscribeFunc } from "./types.js";
import { Connection } from "./connection.js";
import { Store } from "./store.js";
import { getServices } from "./commands.js";
import { isConnectionLost } from "./errors.js";

// Time to wait for more registrations before fetching all services again
const FETCH_DEBOUNCE = 5000; // 5 seconds

type ServiceRegisteredEvent = {
  data: {
    domain: string;
    service: string;
  };
};

type ServiceRemovedEvent = {
  data: {
    domain: string;
    service: string;
  };
};

function processServiceRegistered(
  store: Store<HassServices>,
  event: ServiceRegisteredEvent,
  scheduleFetch: () => void,
) {
  const state = store.state;
  if (state === undefined) return;

  const { domain, service } = event.data;

  if (!state[domain]?.[service]) {
    const domainInfo = {
      ...state[domain],
      [service]: { description: "", fields: {} },
    };
    store.setState({ [domain]: domainInfo });
  }
  scheduleFetch();
}

function processServiceRemoved(
  state: HassServices,
  event: ServiceRemovedEvent,
) {
  if (state === undefined) return null;

  const { domain, service } = event.data;
  const curDomainInfo = state[domain];

  if (!curDomainInfo || !(service in curDomainInfo)) return null;

  const domainInfo: HassDomainServices = {};
  Object.keys(curDomainInfo).forEach((sKey) => {
    if (sKey !== service) domainInfo[sKey] = curDomainInfo[sKey];
  });

  return { [domain]: domainInfo };
}

const fetchServices = (conn: Connection) => getServices(conn);

const subscribeUpdates = (conn: Connection, store: Store<HassServices>) => {
  // One debounced fetch per collection, so connections don't share a timer
  // and tearing the collection down can cancel a pending fetch.
  let fetchTimer: number | undefined;
  const scheduleFetch = () => {
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      fetchTimer = undefined;
      fetchServices(conn)
        .then((services) => store.setState(services, true))
        .catch((err: unknown) => {
          // The collection refreshes itself once the connection is back.
          if (!isConnectionLost(err)) {
            throw err;
          }
        });
    }, FETCH_DEBOUNCE);
  };

  return Promise.all([
    conn.subscribeEvents<ServiceRegisteredEvent>(
      (ev) =>
        processServiceRegistered(
          store,
          ev as ServiceRegisteredEvent,
          scheduleFetch,
        ),
      "service_registered",
    ),
    conn.subscribeEvents<ServiceRemovedEvent>(
      store.action(processServiceRemoved),
      "service_removed",
    ),
  ]).then((unsubs) => () => {
    clearTimeout(fetchTimer);
    unsubs.forEach((fn) => fn());
  });
};

export const servicesColl = (conn: Connection) =>
  getCollection(conn, "_srv", fetchServices, subscribeUpdates);

export const subscribeServices = (
  conn: Connection,
  onChange: (state: HassServices) => void,
): UnsubscribeFunc => servicesColl(conn).subscribe(onChange);
