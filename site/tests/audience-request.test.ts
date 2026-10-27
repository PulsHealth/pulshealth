import {test} from "node:test";
import assert from "node:assert/strict";
import {postAudience} from "../src/lib/audience-request";

test("a stalled audience request aborts without retrying or rejecting to the page",async()=>{
  const original=globalThis.fetch;
  let calls=0;
  let captured:RequestInit|undefined;
  globalThis.fetch=((_url,init)=>{
    calls++;captured=init;
    return new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
    });
  }) as typeof fetch;
  try{
    await postAudience("https://collector.example/api/send","{}",5);
    assert.equal(calls,1);
    assert.equal(captured?.signal?.aborted,true);
    assert.equal(captured?.credentials,"omit");
    assert.equal(captured?.referrerPolicy,"no-referrer");
    assert.equal(captured?.keepalive,true);
  }finally{globalThis.fetch=original;}
});

test("successful and rejected audience responses do not trigger duplicate delivery",async()=>{
  const original=globalThis.fetch;
  try{
    for(const status of [204,503]){
      let calls=0;
      let signal:AbortSignal|null|undefined;
      globalThis.fetch=(async(_url,init)=>{calls++;signal=init?.signal;return new Response(null,{status});}) as typeof fetch;
      await postAudience("https://collector.example/api/send","{}",5);
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(calls,1);
      assert.equal(signal?.aborted,false,"completed requests clear their abort timer");
    }
    globalThis.fetch=(()=>{throw new Error("offline");}) as typeof fetch;
    await assert.doesNotReject(postAudience("https://collector.example/api/send","{}",5));
  }finally{globalThis.fetch=original;}
});

test("audience responses cancel their unused body instead of leaving a stream open",async()=>{
  const original=globalThis.fetch;
  let cancelled=false;
  globalThis.fetch=(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))) as typeof fetch;
  try{
    await postAudience("https://collector.example/api/send","{}",5);
    assert.equal(cancelled,true);
  }finally{globalThis.fetch=original;}
});
