import { describe, expect, it } from "vitest";
import { batch, definition, metrics } from "./model";
import { classifyPath, decideAccounts } from "../accounts/policy";
const step = "HKQuantityTypeIdentifierStepCount";
const id = "70000000-0000-4000-8000-000000000001";
const record = { key:id, type:step, function:"raw", start:100, end:200, value:3, unit:"count" };
describe("collection contract",()=>{
 it("derives units from the generated vocabulary and rejects unsupported aggregate functions",()=>{
  expect(metrics([{type:step,function:"sum",required:true,unit:"wrong"}])[0].unit).toBe("count");
  expect(()=>metrics([{type:step,function:"average",required:true}])).toThrow();
  expect(()=>metrics([{type:"HKWorkoutTypeIdentifier",function:"raw",required:true}])).toThrow();
 });
 it("rejects identity metadata and invalid dates/units instead of silently acknowledging",()=>{
  for(const changes of [{metadata:{name:"private"}},{sourceName:"private"},{start:null},{end:0},{unit:"m"},{value:null}])
   expect(()=>batch({batchID:id,records:[{...record,...changes}],deletions:[]})).toThrow();
  expect(batch({batchID:id,records:[record],deletions:[id]}).records).toHaveLength(1);
 });
 it("rejects fine-grained values mislabeled as daily aggregates and permits DST days",()=>{
  const aggregate={key:`${step}:sum:100`,type:step,function:"sum",start:100,end:86_400_100,value:3,unit:"count"};
  expect(()=>batch({batchID:id,records:[{...aggregate,end:60_100}],deletions:[]})).toThrow();
  for(const hours of [23,24,25]) expect(batch({batchID:id,records:[{...aggregate,end:100+hours*3_600_000}],deletions:[]}).records).toHaveLength(1);
 });
 it("requires purpose, consent and finite bounds",()=>{
  expect(()=>definition({title:"",metrics:[]})).toThrow();
 });
 it("keeps browser writes protected and exempts only exact machine paths",()=>{
  expect(classifyPath('/api/collections')).toBe('protected');
  expect(classifyPath('/api/native/collections')).toBe('oauth');
  expect(classifyPath('/api/sharing')).toBe('oauth');
  expect(classifyPath('/api/sharing/extra')).toBe('protected');
  expect(decideAccounts({pathname:'/api/collections',secure:true,sameOrigin:false,development:false})).toBe('cross-origin');
 });
});
