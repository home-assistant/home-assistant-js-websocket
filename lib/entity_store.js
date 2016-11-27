
class EntityStore {
  constructor() {
    this.listeners = {};
    this.entities = {};
  }

  addEventListener(eventType, listener) {
    let listeners = this.listeners[eventType];

    if (!listeners) {
      listeners = this.listeners[eventType] = [];
    }

    listeners.push(listener);
  }

  fireEvent(eventType) {
    (this.listeners[eventType] || []).forEach(
      listener => listener(this.entities));
  }

  setStates(states) {
    const entities = {};
    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      entities[state.entity_id] = state;
    }
    this.entities = entities;
    this.fireEvent('change');
  }

  updateState(state) {
    const entities = Object.assign({}, this.entities);
    entities[state.entity_id] = state;
    this.entities = entities;
    this.fireEvent('change');
  }

  removeState(entityId) {
    const entities = Object.assign({}, this.entities);
    delete entities[entityId];
    this.entities = entities;
    this.fireEvent('change');
  }

  /* eslint-disable class-methods-use-this */
  unsubscribe() {}
  /* eslint-enable class-methods-use-this */
}

function processEvent(store, event) {
  const state = event.data.new_state;
  if (state) {
    store.updateState(state);
  } else {
    store.removeState(event.data.entity_id);
  }
}

export default function createEntityStore(conn) {
  return new Promise((resolve, reject) => {
    const store = new EntityStore();

    const prom1 = conn.subscribeEvents(processEvent.bind(null, store), 'state_changed').then(
      (unsub) => { store.unsubscribe = unsub; });
    const prom2 = conn.getStates().then(states => store.setStates(states));

    Promise.all([prom1, prom2]).then(() => resolve(store), () => reject());
  });
}
