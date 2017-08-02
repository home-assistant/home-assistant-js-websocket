import assert from 'assert';

import { extractDomain, extractObjectId } from '../lib/util';

describe('extractDomain', () => {
  it('extractDomain should work', () => {
    assert.equal('light', extractDomain('light.kitchen'));
  });
});

describe('extractObjectId', () => {
  it('extractObjectId should work', () => {
    assert.equal('kitchen', extractObjectId('light.kitchen'));
  });
});
