import createCollection from './collection.js';

function processServiceRegistered(state, event) {
  if (state === undefined) return null;

  const { domain, service } = event.data;

  const domainInfo = Object.assign(
    {}, state[domain],
    { [service]: { description: '', fields: {} } }
  );

  return { [domain]: domainInfo };
}

function processServiceRemoved(state, event) {
  if (state === undefined) return null;

  const { domain, service } = event.data;
  const curDomainInfo = state[domain];

  if (!curDomainInfo || !(service in curDomainInfo)) return null;

  const domainInfo = {};
  Object.keys(curDomainInfo).forEach((sKey) => {
    if (sKey !== service) domainInfo[sKey] = curDomainInfo[sKey];
  });

  return { [domain]: domainInfo };
}


const fetchServices = conn => conn.getServices();
const subscribeUpdates = (conn, store) => Promise.all([
  conn.subscribeEvents(store.action(processServiceRegistered), 'service_registered'),
  conn.subscribeEvents(store.action(processServiceRemoved), 'service_removed'),
]).then(unsubs => () => unsubs.forEach(fn => fn()));

export default createCollection(fetchServices, subscribeUpdates);
