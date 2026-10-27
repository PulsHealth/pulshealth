import {test} from "node:test";
import assert from "node:assert/strict";
import {browserExcluded,setBrowserExcluded,appStorePlacement} from "../src/lib/analytics-preferences";
test("browser exclusion persists as one boolean, supports re-enabling and reports storage failures",()=>{
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k) ?? null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 assert.equal(browserExcluded(storage),false);setBrowserExcluded(storage,true);assert.equal(browserExcluded(storage),true);assert.deepEqual([...data],[['umami.disabled','1']]);setBrowserExcluded(storage,false);assert.equal(browserExcluded(storage),false);assert.equal(data.size,0);
 for(const excluded of [true,false])assert.throws(()=>setBrowserExcluded({...storage,getItem:()=>{throw new Error('blocked');}},excluded));
 assert.equal(appStorePlacement('hero'),'hero');assert.equal(appStorePlacement('person@example.com'),'other');assert.equal(appStorePlacement({email:'private'}),'other');
});
