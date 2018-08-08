export function mockConnection() {
  const listeners = {};
  return {
    // connection events
    // eslint-disable-next-line
    addEventListener(event, cb) {},

    // hass events
    subscribeEvents(cb, event = "*") {
      if (!(event in listeners)) {
        listeners[event] = [];
      }
      listeners[event].push(cb);
    },

    mockEvent(event, data) {
      listeners[event].forEach(cb => cb(data));
    }
  };
}

export function createAwaitableEvent() {
  let curPromise;
  let curResolve;

  return {
    set(...args) {
      if (curResolve) curResolve(...args);
    },

    prime() {
      curPromise = new Promise(resolve => {
        curResolve = resolve;
      });
    },

    wait() {
      return curPromise;
    }
  };
}
