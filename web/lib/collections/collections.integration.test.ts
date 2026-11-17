import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { requireIntegrationDatabases } from "../integrationEnv";
import { newToken, tokenHash } from "../accounts/session";
import { definition } from "./model";
const {webUrl,adminUrl}=requireIntegrationDatabases();
describe.skipIf(!webUrl||!adminUrl)("collection authorization (real web_app role)",()=>{
 let admin:Client,web:Client;
 const users=[randomUUID(),randomUUID(),randomUUID()];const sessionTokens=users.map(()=>newToken());const sessions=sessionTokens.map(t=>tokenHash(t)!);
 const invite=tokenHash(newToken())!;let request:string;let grant:string;const token=tokenHash(newToken())!;
 const metric={type:'HKQuantityTypeIdentifierStepCount',function:'raw',required:true,unit:'count'};
 const def=definition({title:'Synthetic walking program',organizer:'Example organizer',kind:'group',purpose:'Test approved collection',contact:'contact@example.test',consentText:'Synthetic integration consent',mode:'ongoing',historyDays:30,durationDays:30,retentionDays:30,metrics:[metric]});
 const cmd=async(action:string,who:number,body:Record<string,unknown>={})=>(await web.query('SELECT collections.command($1,$2,$3) AS result',[action,sessions[who],body])).rows[0].result;
 beforeAll(async()=>{
  process.env.WEB_ACCOUNTS="true";process.env.DATABASE_URL=webUrl;
  admin=new Client({connectionString:adminUrl});web=new Client({connectionString:webUrl});await admin.connect();await web.connect();
  for(let i=0;i<users.length;i++){
   await admin.query('INSERT INTO users(id) VALUES($1)',[users[i]]);
   const a=(await admin.query('INSERT INTO auth.accounts(user_id,email,password_hash,is_admin) VALUES($1,$2,$3,$4) RETURNING id',[users[i],`${users[i]}@example.test`,'fixture-hash',i===2])).rows[0].id;
   await admin.query("INSERT INTO auth.sessions(id,account_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[sessions[i],a]);
  }
  request=(await cmd('create',0,{definition:def,inviteHash:invite.toString('hex'),listed:true})).id;
 });
 afterAll(async()=>{for(const u of users){await admin.query('DELETE FROM auth.accounts WHERE user_id=$1',[u]);await admin.query('DELETE FROM users WHERE id=$1',[u]);}await web.end();await admin.end();});
 it('denies table reads and cross-owner management',async()=>{
  await expect(web.query('SELECT * FROM collections.records')).rejects.toMatchObject({code:'42501'});
  await expect(cmd('close',1,{id:request})).rejects.toMatchObject({code:'P0002'});
  expect((await web.query('SELECT collections.discover(null,null) AS result')).rows[0].result).toEqual([]);
  await expect(cmd('review',0,{id:request,decision:'approved'})).rejects.toMatchObject({code:'42501'});
 });
 it('requires invitation and affirmative scope-specific consent',async()=>{
  await expect(cmd('join',1,{id:request,inviteHash:'',accepted:true,version:1,metrics:[metric],tokenHash:token.toString('hex')})).rejects.toMatchObject({code:'42501'});
  await expect(cmd('join',1,{id:request,inviteHash:invite.toString('hex'),accepted:false,version:1,metrics:[metric],tokenHash:token.toString('hex')})).rejects.toMatchObject({code:'22023'});
  const e=await cmd('join',1,{id:request,inviteHash:invite.toString('hex'),accepted:true,version:1,metrics:[metric],tokenHash:token.toString('hex')});grant=e.id;
  expect(e.metrics).toEqual([metric]);expect(e.request.version).toBe(1);
 });
 it('rejects absent invitation and consent at the database boundary',async()=>{
  const tokenHashHex=tokenHash(newToken())!.toString('hex');
  await expect(cmd('join',2,{id:request,accepted:true,version:1,metrics:[metric],tokenHash:tokenHashHex})).rejects.toMatchObject({code:'42501'});
  await expect(cmd('join',2,{id:request,inviteHash:invite.toString('hex'),version:1,metrics:[metric],tokenHash:tokenHashHex})).rejects.toMatchObject({code:'22023'});
  await expect(cmd('create',0,{definition:{},inviteHash:invite.toString('hex')})).rejects.toMatchObject({code:'22023'});
 });
 it('uses bearer-only native authentication and scopes browser lists',async()=>{
  const {NextRequest}=await import('next/server');
  const {manage,upload}=await import('./http');
  const cookie={cookie:`__Host-puls-session=${sessionTokens[0]}`};
  expect((await manage(new NextRequest('https://example.test/api/native/collections',{headers:cookie}),true)).status).toBe(401);
  const native=await manage(new NextRequest('https://example.test/api/native/collections',{headers:{authorization:`Bearer ${sessionTokens[1]}`}}),true);
  expect(native.status).toBe(200);expect((await native.json()).result.requests).toEqual([]);
  const owner=await manage(new NextRequest('https://example.test/api/collections',{headers:cookie}),false);
  expect((await owner.json()).result.requests).toHaveLength(1);
  expect((await upload(new NextRequest('https://example.test/api/sharing',{method:'POST',headers:cookie,body:'{}'}))).status).toBe(401);
 });
 it('enforces date/type scope, exact idempotent receipts and isolated export',async()=>{
  const id=randomUUID(),digest='a'.repeat(64),now=Date.now();
  const record={key:randomUUID(),type:metric.type,function:'raw',unit:'count',start:now-10000,end:now-5000,value:12};
  const upload=(records:unknown[],d=digest)=>web.query('SELECT collections.upload($1,$2,$3,$4,$5) AS result',[token,id,d,JSON.stringify(records),'[]']);
  await expect(upload([{...record,start:0}])).rejects.toMatchObject({code:'22023'});
  await expect(upload([{...record,type:'HKQuantityTypeIdentifierHeartRate'}])).rejects.toMatchObject({code:'22023'});
  await expect(upload([{...record,sourceName:'private'}])).rejects.toMatchObject({code:'22023'});
  expect((await upload([record])).rows[0].result).toEqual({batchID:id,digest});
  await upload([record]);await expect(upload([record],'b'.repeat(64))).rejects.toMatchObject({code:'22023'});
  expect(await cmd('export',0,{id:request})).toHaveLength(1);
  await expect(cmd('export',1,{id:request})).rejects.toMatchObject({code:'P0002'});
  await cmd('pause',1,{id:grant});
  await expect(upload([record])).rejects.toMatchObject({code:'42501'});
  await expect(cmd('credential',1,{id:grant,tokenHash:tokenHash(newToken())!.toString('hex')})).rejects.toMatchObject({code:'22023'});
  const resumed=await cmd('resume',1,{id:grant,tokenHash:tokenHash(newToken())!.toString('hex')});
  expect(resumed.start).toBeGreaterThan(record.end);expect(resumed.generation).toBe(2);
 });
 it('keeps two simultaneous enrollments independent when one is paused',async()=>{
  const ids:string[]=[];
  try {
   for(let n=0;n<2;n++)ids.push((await cmd('create',0,{definition:def,inviteHash:invite.toString('hex')})).id);
   const tokens=ids.map(()=>tokenHash(newToken())!);
   const grants=[];
   for(let n=0;n<2;n++)grants.push(await cmd('join',1,{id:ids[n],inviteHash:invite.toString('hex'),accepted:true,version:1,metrics:[metric],tokenHash:tokens[n].toString('hex')}));
   await cmd('pause',1,{id:grants[0].id});
   const now=Date.now(),row={key:randomUUID(),type:metric.type,function:'raw',unit:'count',start:now-10000,end:now-5000,value:20};
   const send=(token:Buffer)=>web.query('SELECT collections.upload($1,$2,$3,$4,$5)',[token,randomUUID(),'c'.repeat(64),JSON.stringify([row]),'[]']);
   await expect(send(tokens[0])).rejects.toMatchObject({code:'42501'});
   await send(tokens[1]);
   expect(await cmd('export',0,{id:ids[0]})).toEqual([]);
   expect(await cmd('export',0,{id:ids[1]})).toHaveLength(1);
  } finally {for(const id of ids)await admin.query('DELETE FROM collections.requests WHERE id=$1',[id]);}
 });
 it('keeps fixed windows for late joiners and bounds uploads and resumed sharing',async()=>{
  const now=Date.now(),startAt=now-60*86400000,endAt=now+730*86400000;
  const r=await cmd('create',0,{definition:{...def,startAt,endAt},inviteHash:invite.toString('hex')});
  try {
   const datedToken=tokenHash(newToken())!;
   const join={id:r.id,inviteHash:invite.toString('hex'),accepted:true,version:1,metrics:[metric],tokenHash:datedToken.toString('hex')};
   await expect(cmd('join',1,join)).rejects.toMatchObject({code:'22023'});
   await expect(cmd('join',1,{...join,startAt:startAt+1,endAt})).rejects.toMatchObject({code:'22023'});
   const e=await cmd('join',1,{...join,startAt,endAt});
   expect(e.start).toBe(startAt);expect(e.end).toBe(endAt);
   const row={key:randomUUID(),type:metric.type,function:'raw',unit:'count',start:startAt,end:startAt+1000,value:12};
   const upload=(records:unknown[])=>web.query('SELECT collections.upload($1,$2,$3,$4,$5)',[datedToken,randomUUID(),'d'.repeat(64),JSON.stringify(records),'[]']);
   await expect(upload([{...row,start:startAt-1}])).rejects.toMatchObject({code:'22023'});
   await expect(upload([{...row,end:endAt+1}])).rejects.toMatchObject({code:'22023'});
   await upload([row]);
   await cmd('pause',1,{id:e.id});
   const resumed=await cmd('resume',1,{id:e.id,tokenHash:tokenHash(newToken())!.toString('hex')});
   expect(resumed.start).toBeGreaterThan(startAt);expect(resumed.end).toBe(endAt);
  }finally{await admin.query('DELETE FROM collections.requests WHERE id=$1',[r.id]);}
 });
 it('allows advance enrollment without collecting before the scheduled start',async()=>{
  const startAt=Date.now()+86400000,endAt=startAt+86400000;
  const r=await cmd('create',0,{definition:{...def,startAt,endAt},inviteHash:invite.toString('hex')});
  try{
   const scheduledToken=tokenHash(newToken())!;
   const e=await cmd('join',1,{id:r.id,inviteHash:invite.toString('hex'),accepted:true,version:1,metrics:[metric],startAt,endAt,tokenHash:scheduledToken.toString('hex')});
   await expect(web.query('SELECT collections.upload($1,$2,$3,$4,$5)',[scheduledToken,randomUUID(),'e'.repeat(64),'[]','[]'])).rejects.toMatchObject({code:'42501'});
   await cmd('pause',1,{id:e.id});
   const resumed=await cmd('resume',1,{id:e.id,tokenHash:tokenHash(newToken())!.toString('hex')});
   expect(resumed.start).toBe(startAt);expect(resumed.end).toBe(endAt);
   await admin.query("UPDATE collections.requests SET definition=jsonb_set(definition,'{endAt}',to_jsonb($2::bigint)) WHERE id=$1",[r.id,Date.now()-1000]);
   await expect(cmd('join',2,{id:r.id,inviteHash:invite.toString('hex'),accepted:true,version:1,metrics:[metric],startAt,endAt,tokenHash:scheduledToken.toString('hex')})).rejects.toMatchObject({code:'22023'});
  }finally{await admin.query('DELETE FROM collections.requests WHERE id=$1',[r.id]);}
 });
 it('rejects incomplete or invalid dates at the database boundary',async()=>{
  const now=Date.now();
  for(const change of [{startAt:now},{startAt:null,endAt:now+1000},{startAt:now,endAt:now},{startAt:now-1000,endAt:now-1},{startAt:1.5,endAt:now+1000},{startAt:0,endAt:253402300800000},{startAt:now,endAt:now+1000,mode:'once'}])
   await expect(cmd('create',0,{definition:{...def,...change},inviteHash:invite.toString('hex')})).rejects.toMatchObject({code:'22023'});
 });
 it('enforces retention on reads before the hourly purge and prevents private-role cleanup',async()=>{
  await admin.query("UPDATE collections.records SET received_at=now()-interval '31 days' WHERE enrollment_id=$1",[grant]);
  expect(await cmd('export',0,{id:request})).toEqual([]);
  await expect(web.query("CALL collections.prune(null,null)")).rejects.toMatchObject({code:'42501'});
  await admin.query("CALL collections.prune(null,null)");
  expect((await admin.query('SELECT count(*)::int AS n FROM collections.records WHERE enrollment_id=$1',[grant])).rows[0].n).toBe(0);
 });
 it('publishes only after admin approval and closes every grant',async()=>{
  await cmd('review',2,{id:request,decision:'approved'});
  expect((await web.query('SELECT collections.discover($1,null) AS result',[request])).rows[0].result).toHaveLength(1);
  await cmd('close',0,{id:request});
  expect((await cmd('list',1)).enrollments[0].status).toBe('stopped');
  expect((await web.query('SELECT collections.discover($1,$2) AS result',[request,invite])).rows[0].result).toEqual([]);
 });
 it('isolates deletion requests and confirms only after removing server contributions',async()=>{
  const r=await cmd('create',0,{definition:def,inviteHash:invite.toString('hex')});
  try {
   const hash=tokenHash(newToken())!;
   const e=await cmd('join',1,{id:r.id,inviteHash:invite.toString('hex'),accepted:true,version:1,metrics:[metric],tokenHash:hash.toString('hex')});
   const now=Date.now();
   await web.query('SELECT collections.upload($1,$2,$3,$4,$5)',[hash,randomUUID(),'a'.repeat(64),JSON.stringify([{key:randomUUID(),type:metric.type,function:'raw',unit:'count',start:now-1000,end:now-500,value:10}]),'[]']);
   await expect(cmd('request-deletion',0,{id:e.id,withdraw:true})).rejects.toMatchObject({code:'P0002'});
   await expect(cmd('request-deletion',1,{id:e.id})).rejects.toMatchObject({code:'22023'});
   const requested=await cmd('request-deletion',1,{id:e.id,withdraw:false});
   expect(requested.status).toBe('active');expect(requested.deletionStatus).toBe('requested');
   expect((await cmd('participants',0,{id:r.id}))[0].deletionStatus).toBe('requested');
   await expect(cmd('participants',2,{id:r.id})).rejects.toMatchObject({code:'P0002'});
   await expect(cmd('confirm-deletion',1,{id:e.id})).rejects.toMatchObject({code:'P0002'});
   const confirmed=await cmd('confirm-deletion',0,{id:e.id});
   expect(confirmed.status).toBe('stopped');expect(confirmed.deletionStatus).toBe('confirmed');
   expect(await cmd('export',0,{id:r.id})).toEqual([]);
   expect((await admin.query('SELECT count(*)::int n FROM collections.receipts WHERE enrollment_id=$1',[e.id])).rows[0].n).toBe(0);
   await expect(web.query('SELECT collections.upload($1,$2,$3,$4,$5)',[hash,randomUUID(),'a'.repeat(64),'[]','[]'])).rejects.toMatchObject({code:'42501'});
   await expect(web.query('SELECT collections.command_before_connections($1,$2,$3)',['list',sessions[0],{}])).rejects.toMatchObject({code:'42501'});
  }finally {await admin.query('DELETE FROM collections.requests WHERE id=$1',[r.id]);}
 });
 it('lets the creator join a private group without rotating its invitation',async()=>{
  const r=await cmd('create',0,{definition:def,inviteHash:invite.toString('hex')});
  try {
   const hash=tokenHash(newToken())!.toString('hex');
   const e=await cmd('join',0,{id:r.id,accepted:true,version:1,metrics:[metric],tokenHash:hash});
   expect(e.request.id).toBe(r.id);
   expect((await web.query('SELECT collections.discover($1,$2) result',[r.id,invite])).rows[0].result).toHaveLength(1);
   const stopped=await cmd('request-deletion',0,{id:e.id,withdraw:true});
   expect(stopped.status).toBe('stopped');expect(stopped.deletionStatus).toBe('requested');
   const listed=(await cmd('list',0)).requests.find((v:{id:string})=>v.id===r.id);
   expect(listed.participantCount).toBe(1);
   const discovered=(await web.query('SELECT collections.discover($1,$2) result',[r.id,invite])).rows[0].result[0];
   expect(discovered).not.toHaveProperty('participantCount');
   expect(discovered).not.toHaveProperty('lastContribution');
   expect(e.request).not.toHaveProperty('participantCount');
  }finally {await admin.query('DELETE FROM collections.requests WHERE id=$1',[r.id]);}
 });
 it('deletes participant records with the account, preserving the organizer request',async()=>{
  await admin.query('DELETE FROM auth.accounts WHERE user_id=$1',[users[1]]);
  await admin.query('DELETE FROM users WHERE id=$1',[users[1]]);
  expect(await cmd('export',0,{id:request})).toEqual([]);
  expect((await cmd('list',0)).requests).toHaveLength(1);
 });
});
