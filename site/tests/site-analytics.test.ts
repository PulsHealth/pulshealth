import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeSitePayload} from '../src/lib/site-analytics';
test('restored Umami preserves page and performance measurements while excluding sensitive fields',()=>{
 const raw={url:'/pricing/?email=private#secret',referrer:'https://search.example/private?q=secret',title:'private',id:'person',name:'app_store_click',data:{placement:'hero',email:'private'},screen:'1440x900',language:'en-US'};
 const result=sanitizeSitePayload('event',raw,'/pricing/');
 assert.deepEqual(result,{...raw,url:'/pricing/',referrer:'https://search.example',title:'',id:undefined,data:{placement:'hero'}});
 assert.equal(sanitizeSitePayload('identify',raw,'/'),false);
 const perf=sanitizeSitePayload('performance',{lcp:1234,data:{email:'private'}},'/docs/');
 assert.ok(perf);assert.equal(perf.lcp,1234);assert.equal(perf.data,undefined);
});
