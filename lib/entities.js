import createCollection from './collection.js';

function processEvent(store, event) {
  const state = store.getState();
  if (state === undefined) return;

  /* eslint-disable camelcase */
  const { entity_id, new_state } = event.data;
  if (new_state) {
    store.setState({ [new_state.entity_id]: new_state });
  } else {
    const newEntities = Object.assign({}, state);
    delete newEntities[entity_id];
    store.setState(newEntities, true);
  }
}

async function fetchEntities(conn) {
  const states = await conn.getStates();
  const entities = {};
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    entities[state.entity_id] = state;
  }
  return entities;
}

const subscribeUpdates = (conn, store) =>
  conn.subscribeEvents(ev => processEvent(store, ev), 'state_changed');

export default createCollection(fetchEntities, subscribeUpdates);
