import { getGroupEntities } from './group';
import { extractDomain } from './util';

const DEFAULT_VIEW_ENTITY_ID = 'group.default_view';

// Return an object containing all entities that the view will show
// including embedded groups.
export function getViewEntities(entities, view) {
  const viewEntities = {};

  view.attributes.entity_id.forEach((entityId) => {
    const entity = entities[entityId];

    if (entity && !entity.attributes.hidden) {
      viewEntities[entity.entity_id] = entity;

      if (extractDomain(entity.entity_id) === 'group') {
        const groupEntities = getGroupEntities(entities, entity);

        Object.keys(groupEntities).forEach((grEntityId) => {
          const grEntity = groupEntities[grEntityId];

          if (!grEntity.attributes.hidden) {
            viewEntities[grEntityId] = grEntity;
          }
        });
      }
    }
  });

  return viewEntities;
}

// Return an ordered array of available views
export function extractViews(entities) {
  const views = [];

  Object.keys(entities).forEach((entityId) => {
    const entity = entities[entityId];
    // Entity is a view if it has the 'view' attribute set.
    // Consider default_view as view by default. 
    if (entity.attributes.view ||
        (entity.entity_id === DEFAULT_VIEW_ENTITY_ID && entity.attributes.view !== false)) {
      views.push(entity);
    }
  });

  views.sort((view1, view2) => {
    if (view1.entity_id === DEFAULT_VIEW_ENTITY_ID) {
      return -1;
    } else if (view2.entity_id === DEFAULT_VIEW_ENTITY_ID) {
      return 1;
    }
    return view1.attributes.order - view2.attributes.order;
  });

  return views;
}
