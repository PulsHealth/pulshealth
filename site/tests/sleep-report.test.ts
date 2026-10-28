import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSleepReport,sleepPeriod,sleepTime} from '../src/lib/sleep-report';
import recorded from '../src/lib/sleep-recorded.json';
test('sleep windows preserve missing nights and use only available days',()=>{
 const report=parseSleepReport(JSON.stringify({milestones:[{label:'private child name',availableThrough:2,days:[{offset:-1,minutes:480,awake:0,rem:null,deep:null},{offset:0,minutes:360,awake:30,rem:20,deep:10},{offset:1,minutes:null,awake:null,rem:null,deep:null},{offset:2,minutes:300,awake:null,rem:null,deep:null}]}]}));
 assert.equal(report.milestones[0].label,'First child');
 const summary=sleepPeriod(report.milestones[0],0,30);
 assert.equal(summary.available,3);assert.equal(summary.count,2);assert.equal(summary.median,330);assert.equal(summary.short,50);assert.equal(summary.awakeCount,1);assert.equal(summary.awake,30);
 assert.equal(sleepTime(479.8),'8h 00m');
});
test('relative sleep fixture carries no exact dates or identity and rejects duplicate offsets',()=>{
 const report=parseSleepReport(JSON.stringify(recorded));
 assert.equal(report.milestones.length,2);
 assert.equal(sleepPeriod(report.milestones[0],-90,0).count,90);
 assert.equal(sleepPeriod(report.milestones[1],-90,0).count,89);
 assert.ok(!/\d{4}-\d{2}-\d{2}|uuid|Sean|sources/i.test(JSON.stringify(report)));
 report.milestones[0].days.push(report.milestones[0].days[0]);
 assert.throws(()=>parseSleepReport(JSON.stringify(report)));
});
