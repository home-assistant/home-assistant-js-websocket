export function mockConnection() {
  const listeners = {};
  const responses = {};
  return {
    // connection events
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
    },

    mockResponse(type, data) {
      responses[type] = data;
    },

    async sendMessagePromise(message) {
      if (message.type in responses) {
        return responses[message.type];
      }
      throw new Error("Unexpected type");
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
