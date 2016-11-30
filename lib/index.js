import createConnection from './connection';
import subscribeConfig from './config';
import subscribeEntities from './entities';
import {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
} from './const';
import {
  getGroupEntities,
  splitByGroups,
} from './group';
import {
  getViewEntities,
  extractViews,
} from './view';
import {
  extractDomain,
  extractObjectId,
} from './util';

export {
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,

  createConnection,
  subscribeConfig,
  subscribeEntities,

  getGroupEntities,
  splitByGroups,

  getViewEntities,
  extractViews,

  extractDomain,
  extractObjectId,
};
