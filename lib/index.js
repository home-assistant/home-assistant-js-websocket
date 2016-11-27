import * as messages from './messages';

export const ERR_CANNOT_CONNECT = 1;
export const ERR_INVALID_AUTH = 2;

function extractResult(message) {
  return message.result;
}

class Connection {
  constructor(url, options) {
    this.url = url;
    this.options = options || {};
    this.commandId = 1;
    this.commands = {};
    this.connectionTries = 0;
    this.eventListeners = {};
    this.closeRequested = false;
  }

  addEventListener(eventType, callback) {
    let listeners = this.eventListeners[eventType];

    if (!listeners) {
      listeners = this.eventListeners[eventType] = [];
    }

    listeners.push(callback);
  }

  fireEvent(eventType) {
    (this.eventListeners[eventType] || []).forEach(callback => callback(this));
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Used for resubscribing in the future
      const oldCommands = this.commands;
      Object.keys(oldCommands).forEach((id) => {
        const info = oldCommands[id];

        // Reject stuff still waiting for an answer
        if (info.reject) {
          info.reject();
        }
      });

      // If invalid auth, we will not try to reconnect.
      let invalidAuth = false;

      this.connectionTries += 1;
      this.socket = new WebSocket(this.url);

      this.socket.addEventListener('open', () => {
        this.connectionTries = 0;
      });

      this.socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);

        if (__DEV__) {
          /* eslint-disable no-console */
          console.log('Received', message);
          /* eslint-enable no-console */
        }

        switch (message.type) {
          case 'pong':
            break;

          case 'auth_required':
            this.sendMessage(messages.auth(this.options.authToken));
            break;

          case 'auth_invalid':
            reject({ code: ERR_INVALID_AUTH });
            invalidAuth = true;
            break;

          case 'auth_ok':
            resolve(this);
            this.fireEvent('ready');

            // Re-subscribe to events and update old location of unsub method
            // so old unsub method keeps working.
            this.commandId = 1;
            this.commands = {};

            Object.keys(oldCommands).forEach((id) => {
              const info = oldCommands[id];

              if (info.eventType) {
                this.subscribeEvents(info.eventCallback, info.eventType)
                  .then((unsub) => { info.unsubscribe = unsub; });
              }
            });
            break;

          case 'event':
            this.commands[message.id].eventCallback(message.event);
            break;

          case 'result':
            if (message.success) {
              this.commands[message.id].resolve(message);
            } else {
              this.commands[message.id].reject(message.error);
            }
            delete this.commands[message.id];
            break;

          default:
            if (__DEV__) {
              /* eslint-disable no-console */
              console.warn('Unhandled message', message);
              /* eslint-enable no-console */
            }
        }
      });

      this.socket.addEventListener('close', () => {
        if (invalidAuth || this.closeRequested) {
          // When we have invalid auth, let's not reconnect or we get banned.
          return;
        } else if (this.connectionTries === 0) {
          // We were connected at some point.
          this.fireEvent('disconnected');
        } else {
          // We never were connected
          reject(ERR_CANNOT_CONNECT);
        }

        // Try again
        const waitTime = Math.min(this.connectionTries, 5) * 1000;
        setTimeout(() => this.connect(), waitTime);
      });
    });
  }

  close() {
    this.closeRequested = true;
    this.socket.close();
  }

  getStates() {
    return this.sendMessagePromise(messages.states()).then(extractResult);
  }

  getServices() {
    return this.sendMessagePromise(messages.services()).then(extractResult);
  }

  getPanels() {
    return this.sendMessagePromise(messages.panels()).then(extractResult);
  }

  getConfig() {
    return this.sendMessagePromise(messages.config()).then(extractResult);
  }

  callService(domain, service, serviceData) {
    return this.sendMessagePromise(messages.callService(domain, service, serviceData));
  }

  // eventCallback will be called when a new event fires
  // Returned promise resolves to an unsubscribe function.
  subscribeEvents(eventCallback, eventType) {
    return this.sendMessagePromise(messages.subscribeEvents(eventType)).then(
      (resultMessage) => {
        // We store unsubscribe on info object. That way we can overwrite it in case
        // we get disconnected and we have to subscribe again.
        const info = {
          eventCallback,
          eventType,
          unsubscribe: () => this.sendMessagePromise(messages.unsubscribeEvents(resultMessage.id))
                               .then(() => { delete this.commands[resultMessage.id]; }),
        };

        this.commands[resultMessage.id] = info;

        return () => info.unsubscribe();
      /* eslint-disable comma-dangle */ /* comma crashes Buble */
      }
      /* eslint-enable comma-dangle */
    );
  }

  ping() {
    return this.sendMessagePromise(messages.ping());
  }

  sendMessage(message) {
    if (__DEV__) {
      /* eslint-disable no-console */
      console.log('Sending', message);
      /* eslint-enable no-console */
    }

    this.socket.send(JSON.stringify(message));
  }

  sendMessagePromise(message) {
    return new Promise((resolve, reject) => {
      this.commandId += 1;
      const commandId = this.commandId;
      /* eslint-disable no-param-reassign */
      message.id = commandId;
      /* eslint-enable no-param-reassign */
      this.commands[commandId] = { resolve, reject };
      this.sendMessage(message);
    });
  }
}

export function createConnection(url, options) {
  const conn = new Connection(url, options);
  return conn.connect();
}

export default createConnection;
