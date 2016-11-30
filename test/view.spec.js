import test from 'tape';

import { getViewEntities, extractViews } from '../lib/view';

import { createEntities, createGroup, createView, entityMap } from './test_util';

test('extractViews should work', (t) => {
  const entities = createEntities(10);
  const view1 = createView({ attributes: { order: 10 } });
  entities[view1.entity_id] = view1;

  const view2 = createView({ attributes: { order: 2 } });
  entities[view2.entity_id] = view2;

  const view3 = createView({
    entity_id: 'group.default_view',
    attributes: { order: 8 }
  });
  entities[view3.entity_id] = view3;

  const view4 = createView({ attributes: { order: 4 } });
  entities[view4.entity_id] = view4;

  const expected = [view3, view2, view4, view1];

  t.deepEqual(expected, extractViews(entities));
  t.end();
});

test('getViewEntities should work', (t) => {
  const entities = createEntities(10);
  const entityIds = Object.keys(entities);

  const group1 = createGroup({ attributes: { entity_id: entityIds.splice(0, 2) } });
  entities[group1.entity_id] = group1;

  const group2 = createGroup({ attributes: { entity_id: entityIds.splice(0, 3) } });
  entities[group2.entity_id] = group2;

  const view = createView({
    attributes: {
      entity_id: [group1.entity_id, group2.entity_id].concat(entityIds.splice(0, 2))
    }
  });

  const expectedEntities = entityMap(view.attributes.entity_id.map(ent => entities[ent]));
  Object.assign(
    expectedEntities,
    entityMap(group1.attributes.entity_id.map(ent => entities[ent])));
  Object.assign(
    expectedEntities,
    entityMap(group2.attributes.entity_id.map(ent => entities[ent])));

  t.deepEqual(expectedEntities, getViewEntities(entities, view));
  t.end();
});
