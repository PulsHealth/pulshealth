import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRoutes } from '../src/lib/route-comparisons';
import type { ExampleWorkout } from '../src/lib/example-data';
const route = Array.from({length: 30}, (_,i) => ({lat: 40+i*.0005, lon: -100+Math.sin(i/29*Math.PI)*.002}));
function run(id: string, offset=0): ExampleWorkout {
  return {id,date:'2025-01-01',activity:'Running',distanceM:2000,durationS:700,route:route.map(p=>({lat:p.lat,lon:p.lon+offset}))};
}
test('route matches use geography and direction rather than distance alone', () => {
  const first=run('a'), repeat=run('b',.0001), elsewhere=run('c',.02), reverse=run('d');
  reverse.route!.reverse();
  const groups=compareRoutes([first,repeat,elsewhere,reverse]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].attempts.length,2);
  assert.ok(!JSON.stringify(groups).includes('"lat":'));
  assert.ok(!JSON.stringify(groups).includes('"date":'));
  assert.ok(!JSON.stringify(groups).includes('"id":'));
});
test('missing distances, short tracks and dissimilar run lengths cannot create comparisons', () => {
  const first=run('a'), longer=run('b'), missing=run('c'), short=run('d');
  longer.distanceM=2500;missing.distanceM=null;short.route=short.route!.slice(0,3);
  assert.deepEqual(compareRoutes([first,longer,missing,short]),[]);
});
