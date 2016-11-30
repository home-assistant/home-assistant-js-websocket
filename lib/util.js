
export function extractDomain(entityId) {
  return entityId.substr(0, entityId.indexOf('.'));
}

export function extractObjectId(entityId) {
  return entityId.substr(entityId.indexOf('.') + 1);
}
