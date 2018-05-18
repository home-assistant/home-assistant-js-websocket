import * as messages from './messages';
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,

  MSG_TYPE_AUTH_REQUIRED,
  MSG_TYPE_AUTH_INVALID,
  MSG_TYPE_AUTH_OK,

  MSG_TYPE_EVENT,
  MSG_TYPE_RESULT,
  MSG_TYPE_PONG,
} from './const';

function getSocket(url, options) {
  if (__DEV__) {
    // eslint-disable-next-line
    console.log('[Auth phase] Initializing', url);
  }

  function connect(triesLeft, promResolve, promReject) {
    if (__DEV__) {
      // eslint-disable-next-line
      console.log('[Auth Phase] New connection', url);
    }

    const socket = new WebSocket(url);

    // If invalid auth, we will not try to reconnect.
    let invalidAuth = false;

    const closeMessage = () => {
      // If we are in error handler make sure close handler doesn't also fire.
      socket.removeEventListener('close', closeMessage);

      if (invalidAuth) {
        promReject(ERR_INVALID_AUTH);
        return;
      }

      // Reject if we no longer have to retry
      if (triesLeft === 0) {
        // We never were connected and will not retry
        promReject(ERR_CANNOT_CONNECT);
        return;
      }

      const newTries = triesLeft === -1 ? -1 : triesLeft - 1;
      // Try again in a second
      setTimeout(() => connect(newTries, promResolve, promReject), 1000);
    };

    const handleMessage = (event) => {
      const message = JSON.parse(event.data);

      if (__DEV__) {
        // eslint-disable-next-line
        console.log('[Auth phase] Received', message);
      }
      switch (message.type) {
        case MSG_TYPE_AUTH_REQUIRED:
          if (options.authToken) {
            socket.send(JSON.stringify(messages.auth(options.authToken)));
          } else if (options.accessToken) {
            socket.send(JSON.stringify(messages.authAccessToken(options.accessToken)));
          } else {
            invalidAuth = true;
            socket.close();
          }
          break;

        case MSG_TYPE_AUTH_INVALID:
          invalidAuth = true;
          socket.close();
          break;

        case MSG_TYPE_AUTH_OK:
          socket.removeEventListener('message', handleMessage);
          socket.removeEventListener('close', closeMessage);
          socket.removeEventListener('error', closeMessage);
          promResolve(socket);
          break;

        default:
          if (__DEV__) {
            // eslint-disable-next-line
            console.warn('[Auth phase] Unhandled message', message);
          }
      }
    };

    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', closeMessage);
    socket.addEventListener('error', closeMessage);
  }

  return new Promise((resolve, reject) => connect(options.setupRetry || 0, resolve, reject));
}

function extractResult(message) {
  return message.result;
}

class Connection {
  constructor(url, options) {
    // websocket API url
    this.url = url;
    // connection options
    //  - authToken: auth to use
    //  - setupRetry: amount of ms to retry when unable to connect on initial setup
    this.options = options || {};
    // id if next command to send
    this.commandId = 1;
    // info about active subscriptions and commands in flight
    this.commands = {};
    // map of event listeners
    this.eventListeners = {};
    // true if a close is requested by the user
    this.closeRequested = false;

    this._handleMessage = this._handleMessage.bind(this);
    this._handleClose = this._handleClose.bind(this);
  }

  setSocket(socket) {
    const oldSocket = this.socket;
    this.socket = socket;
    socket.addEventListener('message', this._handleMessage);
    socket.addEventListener('close', this._handleClose);

    if (oldSocket) {
      const oldCommands = this.commands;

      // reset to original state
      this.commandId = 1;
      this.commands = {};

      Object.keys(oldCommands).forEach((id) => {
        const info = oldCommands[id];

        if (info.eventType) {
          this.subscribeEvents(info.eventCallback, info.eventType)
            .then((unsub) => { info.unsubscribe = unsub; });
        }
      });

      this.fireEvent('ready');
    }
  }

  addEventListener(eventType, callback) {
    let listeners = this.eventListeners[eventType];

    if (!listeners) {
      listeners = this.eventListeners[eventType] = [];
    }

    listeners.push(callback);
  }

  removeEventListener(eventType, callback) {
    const listeners = this.eventListeners[eventType];

    if (!listeners) {
      return;
    }

    const index = listeners.indexOf(callback);

    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  fireEvent(eventType, eventData) {
    (this.eventListeners[eventType] || []).forEach(callback => callback(this, eventData));
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
    return this.sendMessagePromise(messages.subscribeEvents(eventType)).then((resultMessage) => {
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
    });
  }

  ping() {
    return this.sendMessagePromise(messages.ping());
  }

  sendMessage(message) {
    if (__DEV__) {
      // eslint-disable-next-line
      console.log('Sending', message);
    }

    this.socket.send(JSON.stringify(message));
  }

  sendMessagePromise(message) {
    return new Promise((resolve, reject) => {
      this.commandId += 1;
      const commandId = this.commandId;
      message.id = commandId;
      this.commands[commandId] = { resolve, reject };
      this.sendMessage(message);
    });
  }

  _handleMessage(event) {
    const message = JSON.parse(event.data);

    if (__DEV__) {
      // eslint-disable-next-line
      console.log('Received', message);
    }

    switch (message.type) {
      case MSG_TYPE_EVENT:
        this.commands[message.id].eventCallback(message.event);
        break;

      case MSG_TYPE_RESULT:
        if (message.success) {
          this.commands[message.id].resolve(message);
        } else {
          this.commands[message.id].reject(message.error);
        }
        delete this.commands[message.id];
        break;

      case MSG_TYPE_PONG:
        break;

      default:
        if (__DEV__) {
          // eslint-disable-next-line
          console.warn('Unhandled message', message);
        }
    }
  }

  _handleClose() {
    // Reject in-flight requests
    Object.keys(this.commands).forEach((id) => {
      const { reject } = this.commands[id];
      if (reject) {
        reject(messages.error(ERR_CONNECTION_LOST, 'Connection lost'));
      }
    });

    if (this.closeRequested) {
      return;
    }

    this.fireEvent('disconnected');

    // Disable setupRetry, we control it here with auto-backoff
    const options = Object.assign({}, this.options, { setupRetry: 0 });

    const reconnect = (tries) => {
      setTimeout(() => {
        if (__DEV__) {
          // eslint-disable-next-line
          console.log('Trying to reconnect');
        }
        getSocket(this.url, options).then(
          socket => this.setSocket(socket),
          err => (err === ERR_INVALID_AUTH ?
            this.fireEvent('reconnect-error', err) : reconnect(tries + 1))
        );
      }, Math.min(tries, 5) * 1000);
    };

    reconnect(0);
  }
}

export default function createConnection(url, options = {}) {
  return getSocket(url, options)
    .then((socket) => {
      const conn = new Connection(url, options);
      conn.setSocket(socket);
      return conn;
    });
}
