import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trackPosition} from '../src/components/examples/run-replay';
import {sampleData,parseExampleData} from '../src/lib/example-data';
test('GPS replay interpolates observed timing and hides long gaps',()=>{
 const track=[{seconds:10,x:0,y:0},{seconds:70,x:60,y:0},{seconds:300,x:100,y:0}];
 assert.equal(trackPosition(track,[0,60,100],0),null);
 assert.equal(trackPosition(track,[0,60,100],40)?.x,30);
 assert.equal(trackPosition(track,[0,60,100],40)?.progress,.3);
 assert.equal(trackPosition(track,[0,60,100],70)?.x,60);
 assert.equal(trackPosition(track,[0,60,100],200),null);
 assert.equal(trackPosition(track,[0,60,100],300)?.progress,1);
});
test('stream imports reject nonfinite values and unordered elapsed time',()=>{
 const data=sampleData();data.workouts[0].streams={heartRate:[{seconds:30,value:150},{seconds:30,value:151}]};
 assert.throws(()=>parseExampleData(JSON.stringify(data)),/increasing/);
 data.workouts[0].streams.heartRate=[{seconds:30,value:-1}];
 assert.throws(()=>parseExampleData(JSON.stringify(data)),/nonnegative/);
});
