import test from 'node:test';
import assert from 'node:assert/strict';
import {pageCategory,sourceCategory} from '../src/lib/site-analytics';
test('audience categories never contain raw paths or referrers',()=>{
 assert.equal(pageCategory('/'),'home');assert.equal(pageCategory('/docs/anything?secret=user'),'docs');assert.equal(pageCategory('/person/private@example.com'),'other');
 assert.equal(sourceCategory('https://chatgpt.com/private?q=secret'),'ai');assert.equal(sourceCategory('https://www.google.com/search?q=private'),'search');assert.equal(sourceCategory('https://private.example/person'),'other');assert.equal(sourceCategory(''),'direct');
});
