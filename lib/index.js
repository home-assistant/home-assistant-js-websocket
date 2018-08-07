import getAuth from './auth.js';
import createConnection from './connection.js';
import subscribeConfig from './config.js';
import subscribeServices from './services.js';
import subscribeEntities from './entities.js';
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
  ERR_HASS_HOST_REQUIRED,
} from './const.js';

export {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
  ERR_HASS_HOST_REQUIRED,

  getAuth,
  createConnection,
  subscribeConfig,
  subscribeServices,
  subscribeEntities,
};
