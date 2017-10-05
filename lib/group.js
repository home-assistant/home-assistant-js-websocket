import { extractDomain } from './util';

export function getGroupEntities(entities, group) {
  const result = {};

  group.attributes.entity_id.forEach((entityId) => {
    const entity = entities[entityId];

    if (entity) {
      result[entity.entity_id] = entity;
    }
  });

  return result;
}

// Split a collection into a list of groups and a 'rest' list of ungrouped
// entities. Groups will be ordered by their order if 'sort' is true.
// Returns { groups: [], ungrouped: {} }
export function splitByGroups(entities, sort = true) {
  const groups = [];
  const ungrouped = {};

  Object.keys(entities).forEach((entityId) => {
    const entity = entities[entityId];

    if (extractDomain(entityId) === 'group') {
      groups.push(entity);
    } else {
      ungrouped[entityId] = entity;
    }
  });

  if (sort) {
    groups.sort((gr1, gr2) => gr1.attributes.order - gr2.attributes.order);
  }

  groups.forEach(
    group => group.attributes.entity_id.forEach(
      (entityId) => { delete ungrouped[entityId]; }));

  return { groups, ungrouped };
}
