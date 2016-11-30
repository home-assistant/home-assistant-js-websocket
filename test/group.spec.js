import test from 'tape';

import { getGroupEntities, splitByGroups } from '../lib/group';

import { createEntities, createGroup, entityMap } from './test_util';

test('getGroupEntities works if all entities exist', (t) => {
  const entities = createEntities(5);
  const entityIds = Object.keys(entities);

  const group = createGroup({ attributes: { entity_id: entityIds.splice(0, 2) } });

  const groupEntities = entityMap(group.attributes.entity_id.map(ent => entities[ent]));
  t.deepEqual(groupEntities, getGroupEntities(entities, group));
  t.end();
});

test("getGroupEntities works if one entity doesn't exist", (t) => {
  const entities = createEntities(5);
  const entityIds = Object.keys(entities);

  const groupEntities = entityMap([
    entities[entityIds[0]],
    entities[entityIds[1]],
  ]);

  const group = createGroup({ attributes: { entity_id: entityIds.splice(0, 2).concat('light.does_not_exist') } });

  t.deepEqual(groupEntities, getGroupEntities(entities, group));
  t.end();
});

test('splitByGroups splits correctly', (t) => {
  const entities = createEntities(7);
  const entityIds = Object.keys(entities);

  const group1 = createGroup({
    attributes: {
      entity_id: entityIds.splice(0, 2),
      order: 6,
    },
  });
  entities[group1.entity_id] = group1;

  const group2 = createGroup({
    attributes: {
      entity_id: entityIds.splice(0, 3),
      order: 4,
    },
  });
  entities[group2.entity_id] = group2;

  const result = splitByGroups(entities);

  const expected = {
    groups: [group2, group1],
    ungrouped: entityMap(entityIds.map(ent => entities[ent])),
  };

  t.deepEqual(expected, result);

  t.end();
});
