import test from 'tape';

import { extractDomain, extractObjectId } from '../lib/util';

test('extractDomain should work', (t) => {
  t.equal('light', extractDomain('light.kitchen'));
  t.end();
});

test('extractObjectId should work', (t) => {
  t.equal('kitchen', extractObjectId('light.kitchen'));
  t.end();
});
