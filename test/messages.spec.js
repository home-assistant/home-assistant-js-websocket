import assert from 'assert';

import * as messages from '../lib/messages';

describe('auth access token message', () => {
  it('should contain access token', () => {
    assert.deepEqual(messages.authAccessToken('hello'), {
      type: 'auth',
      access_token: 'hello',
    });
  });
});
