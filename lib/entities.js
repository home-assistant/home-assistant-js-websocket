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
  if (conn._subscribeEntities) {
    return conn._subscribeEntities(entitiesChanged);
  }

  return new Promise((resolve, reject) => {
    let entities = null;
    let entitiesUnsub = null;
    const listeners = [];
    let initPromise = null;

    if (entitiesChanged) {
      listeners.push(entitiesChanged);
    }

    function processEvent(event) {
      if (entities === null) return;

      /* eslint-disable camelcase */
      const { entity_id, new_state } = event.data;
      if (new_state) {
        entities = updateState(entities, new_state);
      } else {
        entities = removeState(entities, entity_id);
      }

      for (let i = 0; i < listeners.length; i++) {
        listeners[i](entities);
      }
    }

    function fetchAll() {
      return conn.getStates().then((states) => {
        entities = getEntities(states);

        for (let i = 0; i < listeners.length; i++) {
          listeners[i](entities);
        }
      });
    }

    function removeListener(listener) {
      if (listener) {
        listeners.splice(listeners.indexOf(listener), 1);
      }

      // Last listener removed, clean up.
      if (listeners.length === 0) {
        entitiesUnsub();
        conn.removeEventListener('ready', fetchAll);
        conn._subscribeEntities = null;
      }
    }

    conn._subscribeEntities = (listener) => {
      if (listener) {
        listeners.push(listener);

        // If entities is null, fetching promise still has to resolve
        if (entities !== null) {
          listener(entities);
        }
      }
      return initPromise.then(() => () => removeListener(listener));
    };

    initPromise = Promise.all([
      conn.subscribeEvents(processEvent, 'state_changed'), fetchAll(),
    ]);

    initPromise.then(
      ([unsub]) => {
        entitiesUnsub = unsub;
        conn.addEventListener('ready', fetchAll);
        resolve(() => removeListener(entitiesChanged));
      },
      () => reject()
    );
  });
}
