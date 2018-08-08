import createCollection from './collection.js';

function processComponentLoaded(state, event) {
  if (state === undefined) return null;

  return {
    components: state.components.concat(event.data.component)
  };
}

const fetchConfig = conn => conn.getConfig();
const subscribeUpdates = (conn, store) =>
  conn.subscribeEvents(store.action(processComponentLoaded), 'component_loaded');

export default createCollection(fetchConfig, subscribeUpdates);
