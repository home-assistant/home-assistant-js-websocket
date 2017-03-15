# :aerial_tramway: JavaScript websocket client for Home Assistant

This is a websocket client written in JavaScript that communicates with the Home Assistant websocket API. It can be used to integrate Home Assistant into your apps. It has 0 dependencies.

```javascript
import { createConnection, subscribeEntities } from 'home-assistant-js-websocket';

function stateChanged(event) {
  console.log('state changed', event);
}

createConnection('ws://localhost:8123/api/websocket').then(
  (conn) => {
    console.log('Connection established!');
    subscribeEntities(conn, entities => console.log('New entities!', entities));
  },
  err => console.error('Connection failed with code', err)
)
```

[Try it on JSFiddle.](https://jsfiddle.net/balloob/9w3oyswa/)

## Usage

### Initializing connection

Connections to the websocket API are initiated by calling `createConnection(url[, options])`. `createConnection` will return a promise that will resolve to either a `Connection` object or rejects with an error code.

#### Available options

Currently the following options are available:

| Option | Description |
| ------ | ----------- |
| authToken | Auth token to use to validate with Home Assistant.
| setupRetry | Number of times to retry initial connection when it fails. -1 means infinite.

#### Possible error codes

Currently the following error codes can be expected:

| Error | Description |
| ----- | ----------- |
| ERR_CANNOT_CONNECT | If the client was unable to connect to the websocket API.
| ERR_INVALID_AUTH | If the supplied authentication was invalid.

You can import them into your code as follows:

```javascript
import { ERR_CANNOT_CONNECT, ERR_INVALID_AUTH } from 'home-assistant-js-websocket';
```

#### Automatic reconnecting

The connection object will automatically try to reconnect to the server when the connection gets lost. On reconnect, it will automatically resubscribe the event listeners.

The `Connection` object implements two events to signal loss of connection and successful reconnect.

| Event | Description |
| ----- | ----------- |
| ready | Fired when authentication is successful and the connection is ready to take commands.
| disconnected | Fired when the connection is lost.

You can attach and remove listeners as follows:

```javascript
function eventHandler() {
  console.log('Connection has been established again');
}

conn.addEventListener('ready', eventHandler);
conn.removeEventListener('ready', eventHandler);
```

### Entities

You can subscribe to the entities of Home Assistant. Your callback will be called when the entities are first loaded and on every change to the state of any of the entities after that. The callback will be called with a single object that contains the entities keyed by entity_id.

The function `subscribeEntities` will return a promise that resolves to an unsubscribe function.

```javascript
import { subscribeEntities } from 'home-assistant-js-websocket';

// conn is the connection from earlier.

subscribeEntities(conn, entities => console.log('New entities!', entities));
```

### Config

You can subscribe to the config of Home Assistant. Config can change when either a component gets loaded or a new service gets registered.

The function `subscribeConfig` will return a promise that resolves to an unsubscribe function.

```javascript
import { subscribeConfig } from 'home-assistant-js-websocket';

// conn is the connection from earlier.

subscribeConfig(conn, config => console.log('New config!', config));
```

### Managing entities

A few helper methods are included to help display the returned entities.

#### getGroupEntities(entities, group)

Returns an object with only the entities referenced by `group`.

#### splitByGroups(entities)

Split `entities` into the groups that are contained in `entities` and a collection of entities that do not belong to a group. Groups will be returned sorted by order.

```json5
{
  groups: [
    { entity_id: 'group.example_1', state: … },
    { entity_id: 'group.example_2', state: … },
  ],
  ungrouped: {
    'sensor.temperature': { entity_id: … },
    'sensor.humidity': { entity_id: … },
  }
}
```

#### getViewEntities(entities, view)

Returns an object containing all the entities from `entities` that are needed to render this view.

#### extractViews(entities)

Returns an ordered list of available views in `entities`.

#### extractDomain(entityId)

Returns the domain of `entityId`.

```javascript
extractDomain('light.kitchen')  # 'light'
```

#### extractObjectId(entityId)

Returns the object id of `entityId`.

```javascript
extractObjectId('light.kitchen')  # 'kitchen'
```

## Connection API Reference

##### `conn.getStates()`

Get the state of all entities. Returns a promise that will resolve to the result of querying the server for all the states.

##### `conn.getServices()`

Get all available services. Returns a promise that will resolve to the result of querying the server for all the services.

##### `conn.getPanels()`

Get the Home Assistant panel config. Returns a promise that will resolve to the result of querying the server for all the panels config.

##### `conn.getConfig()`

Get the Home Assistant server config. Returns a promise that will resolve to the result of querying the server for all the config.

##### `conn.callService(domain, service[, serviceData])`

Call a service within Home Assistant. Returns a promise that will resolve when the service has been called successfully.

##### `conn.subscribeEvents(eventCallback[, eventType])`

Subscribe to all or specific events on the Home Assistant bus. Calls `eventCallback` for each event that gets received.

Returns a promise that will resolve to a function that will cancel the subscription once called.

##### `conn.addEventListener(eventType, listener)`

Listen for events on the connection. [See docs.](#automatic-reconnecting)
