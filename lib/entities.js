function getEntities(states) {
  const entities = {};
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    entities[state.entity_id] = state;
  }
  return entities;
}

function updateState(entities, state) {
  const newEntities = Object.assign({}, entities);
  newEntities[state.entity_id] = state;
  return newEntities;
}

function removeState(entities, entityId) {
  const newEntities = Object.assign({}, entities);
  delete newEntities[entityId];
  return newEntities;
}

export default function subscribeEntities(conn, entitiesChanged) {
  return new Promise((resolve, reject) => {
    let entities = null;

    function processEvent(event) {
      /* eslint-disable camelcase */
      const { entity_id, new_state } = event.data;
      if (new_state) {
        entities = updateState(entities, new_state);
      } else {
        entities = removeState(entities, entity_id);
      }
      entitiesChanged(entities);
    }

    function fetchAll() {
      return conn.getStates().then((states) => {
        entities = getEntities(states);
        entitiesChanged(entities);
      });
    }

    Promise.all([
      conn.subscribeEvents(processEvent, 'state_changed'), fetchAll(),
    ]).then(
      ([unsub]) => {
        conn.addEventListener('ready', fetchAll);

        resolve(() => {
          conn.removeEventListener('ready', fetchAll);
          unsub();
        });
      },
      () => reject());
  });
}
