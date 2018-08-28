# :aerial_tramway: JavaScript websocket client for Home Assistant

This is a websocket client written in JavaScript that allows retrieving authentication tokens and communicate with the Home Assistant websocket API. It can be used to integrate Home Assistant into your apps. It has 0 dependencies.

## Trying it out

We've included an [example client](https://github.com/home-assistant/home-assistant-js-websocket/blob/master/example.html) based on this lib so that it's easy to try it out:

```bash
yarn build
npx http-server -o
# A browser will open, navigate to example.html
```

## Usage

To initialize a connection, you need an authentication token for the instance that you want to connect to. This library implements the necessary steps to guide the user to authenticate your website with their Home Assistant instance and give you a token. All you need from the user is the url of their instance.

```js
// Example connect code
import {
  getAuth,
  createConnection,
  subscribeEntities,
  ERR_HASS_HOST_REQUIRED
} from "home-assistant-js-websocket";

async function connect() {
  let auth;
  try {
    // Try to pick up authentication after user logs in
    auth = await getAuth();
  } catch (err) {
    if (err === ERR_HASS_HOST_REQUIRED) {
      const hassUrl = prompt(
        "What host to connect to?",
        "http://localhost:8123"
      );
      // Redirect user to log in on their instance
      auth = await getAuth({ hassUrl });
    } else {
      alert(`Unknown error: ${err}`);
      return;
    }
  }
  const connection = await createConnection({ auth });
  subscribeEntities(connection, ent => console.log(ent));
}

connect();
```

### `getAuth()`

Use this method to get authentication from a server via OAuth2. This method will handle redirecting to an instance and fetchin the token after the user successful logs in.

You can pass options using the syntax:

```js
getAuth({ hassUrl: "http://localhost:8123" });
```

| Option      | Description                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hassUrl     | The url where the Home Assistant instance can be reached. This option is needed so we know where to redirect the user for authentication. Once redirected back, it is not needed to pass this option in. |
| clientId    | Client ID to use. Client IDs for Home Assistant is the url of your application. Defaults to domain of current page.                                                                                      |
| redirectUrl | The url to redirect back to when the user has logged in. Defaults to current page.                                                                                                                       |
| saveTokens  | Function to store an object containing the token information.                                                                                                                                            |
| loadTokens  | Function that returns a promise that resolves to previously stored token information object or undefined if no info available.                                                                           |

In certain instances `getAuth` will raise an error. These errors can be imported from the package:

```js
// When bundling your application
import {
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_AUTH
} from "home-assistant-js-websocket";

// When using the UMD build
HAWS.ERR_HASS_HOST_REQUIRED;
```

| Error                    | Description                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_HASS_HOST_REQUIRED` | You need to pass in `hassUrl` to `getAuth` to continue getting auth. This option is not needed when the user is redirected back after successfully logging in. |
| `ERR_INVALID_AUTH`       | This error will be raised if the url contains an authorization code that is no longer valid.                                                                   |
| Other errors             | Unknown error!                                                                                                                                                 |

### `createConnection()`

You need to either provide `auth` or `createSocket` as options to createConnection:

```js
createConnection({ auth });
```

| Option       | Description                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| auth         | Auth object to use to create a connection.                                                                                                     |
| createSocket | Override the createSocket method with your own. `(options) => Promise<WebSocket>`. Needs to return a connection that is already authenticated. |
| setupRetry   | Number of times to retry initial connection when it fails. Set to -1 for infinite retries. Default is 0 (no retries)                           |

Currently the following error codes can be raised by createConnection:

| Error              | Description                                               |
| ------------------ | --------------------------------------------------------- |
| ERR_CANNOT_CONNECT | If the client was unable to connect to the websocket API. |
| ERR_INVALID_AUTH   | If the supplied authentication was invalid.               |

You can import them into your code as follows:

```javascript
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH
} from "home-assistant-js-websocket";
```

### Automatic reconnecting

The connection object will automatically try to reconnect to the server when the connection gets lost. On reconnect, it will automatically resubscribe the event listeners.

The `Connection` object implements three events related to the reconnecting logic.

| Event           | Data       | Description                                                                                              |
| --------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| ready           | -          | Fired when authentication is successful and the connection is ready to take commands.                    |
| disconnected    | -          | Fired when the connection is lost.                                                                       |
| reconnect-error | Error code | Fired when we encounter a fatal error when trying to reconnect. Currently limited to `ERR_INVALID_AUTH`. |

You can attach and remove listeners as follows:

```javascript
function eventHandler(connection, data) {
  console.log("Connection has been established again");
}

conn.addEventListener("ready", eventHandler);
conn.removeEventListener("ready", eventHandler);
```

### Entities

You can subscribe to the entities of Home Assistant. Your callback will be called when the entities are first loaded and on every change to the state of any of the entities after that. The callback will be called with a single object that contains the entities keyed by entity_id.

The function `subscribeEntities` will return an unsubscribe function.

```javascript
import { subscribeEntities } from "home-assistant-js-websocket";

// conn is the connection from earlier.

subscribeEntities(conn, entities => console.log("New entities!", entities));
```

### Config

You can subscribe to the config of Home Assistant. Config can change when either a component gets loaded.

The function `subscribeConfig` will return an unsubscribe function.

```javascript
import { subscribeConfig } from "home-assistant-js-websocket";

// conn is the connection from earlier.

subscribeConfig(conn, config => console.log("New config!", config));
```

### Services

You can subscribe to the available services of Home Assistant. Services can change when a new service gets registered or removed.

The function `subscribeServices` will return an unsubscribe function.

```javascript
import { subscribeServices } from "home-assistant-js-websocket";

// conn is the connection from earlier.

subscribeServices(conn, services => console.log("New services!", services));
```

### Collections

Besides entities, config and services you might want to create your own collections. A collection has the following features:

- Fetch a full data set on initial creation and on reconnect
- Subscribe to events to keep collection up to date
- Share subscription between multiple listeners

```typescript
createCollection(
  key: string,
  fetchCollection: (conn: Connection) => Promise<State>,
  subscribeUpdates: (
    conn: Connection,
    store: Store<State>
  ) => Promise<() => void>,
  conn: Connection,
  onChange: (state: State) => void
)
```

- `key` a unique key for the collection
- `fetchCollection` needs to return a Promsise that resolves to the full state
- `subscribeUpdates` needs to subscribe to the updates and update the store. Returns a promise that resolves to an unsubscribe function.
- `conn` is the connection to subscribe to.
- `onChange` is the callback to be called when collection is changed.

The idea is that your collection code creates a function that fills in the first three parameters and then exposes a `subscribeX(conn, onChange)` function for other code to call.

#### Collection Example

```javascript
import { createCollection } from "home-assistant-js-websocket";

function panelRegistered(state, event) {
  // Returning null means no change.
  if (state === undefined) return null;

  // This will be merged with the existing state.
  return {
    panels: state.panels.concat(event.data.panel)
  };
}

const fetchPanels = conn => conn.sendMessagePromise({ type: "get_panels" });
const subscribeUpdates = (conn, store) =>
  conn.subscribeEvents(store.action(panelRegistered), "panel_registered");

const subscribePanels = (conn, onChange) =>
  createCollection("_pnl", fetchPanels, subscribeUpdates, conn, onChange);

// Now use collection
subscribePanels(conn, panels => console.log("New panels!", panels));
```

Collections are useful to define if data is needed for initial data load. You can create a collection and have code on your page call it before you start rendering the UI. By the time UI is loaded, the data will be available to use.

## Connection API Reference

##### `conn.getStates()`

Get the state of all entities. Returns a promise that will resolve to the result of querying the server for all the states.

##### `conn.getServices()`

Get all available services. Returns a promise that will resolve to the result of querying the server for all the services.

##### `conn.getConfig()`

Get the Home Assistant server config. Returns a promise that will resolve to the result of querying the server for all the config.

##### `conn.callService(domain, service[, serviceData])`

Call a service within Home Assistant. Returns a promise that will resolve when the service has been called successfully.

##### `conn.subscribeEvents(eventCallback[, eventType])`

Subscribe to all or specific events on the Home Assistant bus. Calls `eventCallback` for each event that gets received.

Returns a promise that will resolve to a function that will cancel the subscription once called.

##### `conn.addEventListener(eventType, listener)`

Listen for events on the connection. [See docs.](#automatic-reconnecting)

##### `conn.sendMessagePromise(message)`

Send a message to the server. Returns a promise that resolves or rejects based on the result of the server. Special case rejection is `ERR_CONNECTION_LOST` if the connection is lost while the command is in progress.

## Using this in NodeJS

To use this package in NodeJS, you will want to define your own `createSocket` method for `createConnection` to use. Your createSocket function will need to set up the web socket connection with Home Assistant and handle the auth.

```js
const WebSocket = require("ws");

createConnection({
  createSocket() {
    // Open connection
    const ws = new WebSocket("ws://localhost:8123");

    // Functions to handle authentication with Home Assistant
    // Implement yourself :)

    return ws;
  }
});
```
