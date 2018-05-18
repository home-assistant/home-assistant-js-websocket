import createConnection from './connection';
import subscribeConfig from './config';
import subscribeEntities from './entities';
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST
} from './const';

export {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,

  createConnection,
  subscribeConfig,
  subscribeEntities,
};
