"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { COLLECTION_TYPES, type CollectionRequest, type CollectionMetric, type CollectionList, type RequestDefinition } from "@/lib/collections/model";
import { typeByIdentifier } from "@/lib/catalog";

async function command(action: string, fields: Record<string, unknown> = {}) {
  const response = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...fields }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Unable to save changes.");
  return data;
}
const initial: RequestDefinition = { title: "", organizer: "", kind: "general", purpose: "", contact: "", consentText: "", mode: "ongoing", historyDays: 30, durationDays: 90, retentionDays: 90, metrics: [] };
export function RequestSummary({ request: r }: { request: CollectionRequest }) {
  return <><div className="eyebrow">{r.kind === "study" ? "Research study" : r.kind === "group" ? "Group program" : "Collection request"} · {r.organizer}</div>
    <h2>{r.title}</h2><p>{r.purpose}</p>
    <div className="collection-facts"><span>{r.mode === "once" ? "One-time contribution" : `${r.durationDays} days of ongoing sharing`}</span><span>{r.historyDays} days of history</span><span>Retained for {r.retentionDays} days after receipt</span></div>
    <ul className="collection-metrics">{r.metrics.map(m => <li key={`${m.type}:${m.function}`}><strong>{typeByIdentifier(m.type)?.name}</strong><span>{m.function === "raw" ? "Individual records" : `Daily ${m.function}`} · {m.required ? "Required" : "Optional"}</span></li>)}</ul>
    <p className="collection-small">{r.consentText}</p><p className="collection-small">Contact: {r.contact}</p></>;
}
function CreateRequest({ onCreated }: { onCreated: (r: CollectionRequest, invite: string) => void }) {
  const [draft, setDraft] = useState(initial), [search, setSearch] = useState("");
  const [listed, setListed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = <K extends keyof RequestDefinition>(key: K, value: RequestDefinition[K]) => setDraft(d => ({ ...d, [key]: value }));
  function add(type: string) {
    const t = typeByIdentifier(type)!;
    const metric: CollectionMetric = { type, function: t.allowedAggregateFunctions[0] ?? "raw", required: true, unit: t.unit };
    set("metrics", [...draft.metrics, metric]);
  }
  return <form className="collection-create panel" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { const d = await command("create", { definition: draft, listed }); onCreated(d.result, d.invite); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
    <div className="eyebrow">New request</div><h2>Ask for just what you need.</h2><p>People review the scope before sharing. Each request is independent of their personal database.</p>
    <div className="collection-grid">{([['title','Request name'],['organizer','Person or organization'],['contact','Contact email or URL']] as const).map(([key,label]) => <label key={key}>{label}<input required maxLength={key === 'contact' ? 254 : 120} value={draft[key]} onChange={e => set(key,e.target.value)} /></label>)}
    <label>Request type<select value={draft.kind} onChange={e => set("kind",e.target.value as RequestDefinition['kind'])}><option value="general">General request</option><option value="group">Group program</option><option value="study">Research study</option></select></label></div>
    <label>Purpose<textarea required maxLength={2000} value={draft.purpose} onChange={e => set("purpose",e.target.value)} placeholder="What are you collecting, and how will it be used?" /></label>
    <div className="collection-grid"><label>Schedule<select value={draft.mode} onChange={e => set("mode",e.target.value as RequestDefinition['mode'])}><option value="ongoing">Ongoing</option><option value="once">One time</option></select></label>
    {([['historyDays','History to include',3650],['durationDays','Ongoing duration',365],['retentionDays','Retention after receipt',365]] as const).filter(([key]) => key !== 'durationDays' || draft.mode === 'ongoing').map(([key,label,max]) => <label key={key}>{label} (days)<input type="number" required min={1} max={max} value={draft[key]} onChange={e => set(key,Number(e.target.value))} /></label>)}</div>
    <h3>Requested data</h3><p className="collection-small">Quantity and category types are supported. Daily summaries reduce detail. Device names, sources, profile and metadata are excluded.</p>
    {draft.metrics.map((m,i) => { const t = typeByIdentifier(m.type)!; return <div className="collection-metric-edit" key={m.type}><strong>{t.name}</strong><select aria-label={`${t.name} detail`} value={m.function} onChange={e => set("metrics",draft.metrics.map((v,j) => j === i ? { ...v,function:e.target.value,unit:e.target.value==='duration'?'s':t.unit } : v))}><option value="raw">Individual records</option>{t.allowedAggregateFunctions.map(f => <option value={f} key={f}>Daily {f}</option>)}</select><label><input type="checkbox" checked={m.required} onChange={e => set("metrics",draft.metrics.map((v,j)=>j===i?{...v,required:e.target.checked}:v))} />Required</label><button type="button" className="btn" onClick={()=>set("metrics",draft.metrics.filter((_,j)=>j!==i))} aria-label={`Remove ${t.name}`}>Remove</button></div>; })}
    <label>Find a metric<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search Health types" /></label>
    <div className="collection-type-picker">{COLLECTION_TYPES.filter(t => !draft.metrics.some(m=>m.type===t.identifier) && t.name.toLowerCase().includes(search.toLowerCase())).slice(0,12).map(t=><button type="button" className="btn" key={t.identifier} disabled={draft.metrics.length>=30} onClick={()=>add(t.identifier)}>+ {t.name}</button>)}</div>
    <label>Consent and data use<textarea required maxLength={5000} value={draft.consentText} onChange={e=>set("consentText",e.target.value)} placeholder="Who can access contributions? Describe intended use, withdrawal, contact and any study consent requirements." /></label>
    <p className="collection-small">PulsHealth stores contributions for this request. You can download them; downloaded copies remain your responsibility. Stopping sharing prevents future uploads and does not recall previous downloads. Creating a research study does not provide ethics approval.</p>
    <label className="collection-check"><input type="checkbox" checked={listed} onChange={e=>setListed(e.target.checked)} />Submit to Browse opportunities for administrator review</label>
    <p className="collection-small">Invitation-only by default. Scope is fixed once created; create a new request to ask for different data.</p>
    {error && <p role="alert" className="form-message error">{error}</p>}<button className="btn primary" disabled={busy || !draft.metrics.length}>{busy?'Creating…':'Create request'}</button>
  </form>;
}
export function CollectionRequests({ admin = false }: { admin?: boolean }) {
  const [data,setData] = useState<CollectionList>({requests:[],enrollments:[]}), [creating,setCreating]=useState(false), [selected,setSelected]=useState<CollectionRequest|null>(null);
  const [invite,setInvite]=useState(""), [message,setMessage]=useState(""), [busy,setBusy]=useState(false), [review,setReview]=useState<CollectionRequest[]>([]);
  const [exportCursor,setExportCursor]=useState(0);
  const [participants,setParticipants]=useState<{id:string;status:string;lastReceived:number|null}[]|null>(null);
  async function refresh(){const d=await command("list");setData(d.result);if(admin)setReview((await command("review-list")).result);}
  useEffect(()=>{let active=true;command("list").then(d=>{if(active)setData(d.result);}).catch(e=>{if(active)setMessage(e.message);});if(admin)command("review-list").then(d=>{if(active)setReview(d.result);}).catch(()=>{});return()=>{active=false;};},[admin]);
  async function run(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function download(r:CollectionRequest){
    const {result}=await command("export",{id:r.id,after:exportCursor});
    const chunks:string[]=result.map((row:unknown)=>JSON.stringify(row)+"\n");
    setExportCursor(result.length===1000?result[result.length-1].cursor:0);
    const url=URL.createObjectURL(new Blob(chunks,{type:"application/x-ndjson"}));const a=document.createElement("a");a.href=url;a.download=`request-${r.id}.ndjson`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setMessage(`${chunks.length} records downloaded.${result.length===1000?" More records may be available; choose Download next page.":" This is the last page."} Keep downloaded copies within your stated data-use and retention policy.`);
  }
  return <div className="collections"><div className="collection-heading"><div><div className="eyebrow">Requests</div><h1>Collect with permission.</h1><p>Requests for individuals, groups and studies. Collect once or on an ongoing basis, with a separate agreement for every participant.</p></div><button className="btn primary" onClick={()=>{setCreating(!creating);setSelected(null);}}>{creating?'Cancel':'Create request'}</button></div>
    {message&&<p role="status" className="form-message">{message}</p>}
    {creating?<CreateRequest onCreated={(r,i)=>{setCreating(false);setSelected(r);setInvite(`${location.origin}/collect/${r.id}#${i}`);void refresh();}}/>:selected?<section className="panel collection-detail"><button className="btn" onClick={()=>{setSelected(null);setParticipants(null);setInvite("");}}>← All requests</button><RequestSummary request={selected}/><p><span className="chip">{selected.status}</span> <span className="chip">{selected.listing==='private'?'Invitation only':`Directory: ${selected.listing}`}</span></p>
    <div className="collection-actions"><button className="btn" disabled={busy||selected.status!=='open'} onClick={()=>run(async()=>{const d=await command("invite",{id:selected.id});setInvite(`${location.origin}/collect/${selected.id}#${d.invite}`);})}>Create new invitation link</button><button className="btn" disabled={busy} onClick={()=>run(async()=>{setParticipants((await command("participants",{id:selected.id})).result);})}>Participants</button><button className="btn" disabled={busy} onClick={()=>run(()=>download(selected))}>{exportCursor ? "Download next page" : "Download contributions"}</button><button className="btn" disabled={busy||selected.status!=='open'} onClick={()=>{if(confirm('Close this request and stop future uploads for everyone?'))void run(async()=>{setSelected((await command('close',{id:selected.id})).result);});}}>Close request</button></div>
    {invite&&<div className="collection-invite"><label>Invitation link<input readOnly value={invite}/></label><button className="btn" onClick={()=>navigator.clipboard.writeText(invite).then(()=>setMessage('Invitation copied.')).catch(()=>setMessage('Select and copy the invitation link.'))}>Copy link</button><p className="collection-small">Keep this link with the people you invite. Creating another link invalidates the old one; existing sharing continues.</p></div>}
    {participants&&<div><h3>{participants.length} participants</h3>{participants.map(p=><div className="collection-participant" key={p.id}><code>{p.id.slice(0,8)}</code><span>{p.status}</span><span>{p.lastReceived?`Last receipt ${new Date(p.lastReceived).toLocaleString()}`:'No contribution received'}</span></div>)}<p className="collection-small">Participant codes are specific to this request. No account names or email addresses are included.</p></div>}</section>:<><div className="collection-grid">{data.requests.map(r=><button className="panel collection-card" key={r.id} onClick={()=> {setSelected(r);setExportCursor(0);}}><span className="eyebrow">{r.kind} · {r.status}</span><h2>{r.title}</h2><p>{r.organizer}</p><span>{r.metrics.length} metrics · {r.mode==='once'?'One time':'Ongoing'}</span></button>)}</div>{!data.requests.length&&<section className="panel collection-detail"><h2>Your first request starts here.</h2><p>Create a request for a person, group or study. Choose the data, explain its use, then share an invitation.</p></section>}
    {data.enrollments.length>0&&<section><h2>Your sharing</h2>{data.enrollments.map(e=><div className="panel collection-participant" key={e.id}><strong>{e.request.title}</strong><span>{e.status}</span>{e.status==='active'&&e.request.mode==='ongoing'&&<button className="btn" disabled={busy} onClick={()=>run(async()=>{await command('pause',{id:e.id});})}>Pause</button>}{['active','paused'].includes(e.status)&&<button className="btn" disabled={busy} onClick={()=>{if(confirm('Stop this sharing? Previous contributions remain subject to the request retention policy.'))void run(async()=>{await command('stop',{id:e.id});});}}>Stop sharing</button>}</div>)}<p className="collection-small">Use the iPhone app to review data, resume sharing, or send a contribution.</p></section>}
    <Link href="/opportunities" className="btn">Browse opportunities →</Link></>}
    {admin&&review.length>0&&<section><h2>Directory review</h2>{review.map(r=><div className="panel collection-detail" key={r.id}><RequestSummary request={r}/><div className="collection-actions">{['approved','declined'].map(decision=><button key={decision} className="btn" disabled={busy} onClick={()=>run(async()=>{await command('review',{id:r.id,decision});})}>{decision==='approved'?'Approve listing':'Decline'}</button>)}</div></div>)}</section>}
  </div>;
}
export function CollectionInvitation({id}:{id?:string}) {
  const [rows,setRows]=useState<CollectionRequest[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[code,setCode]=useState('');
  useEffect(()=>{const invitation=location.hash.slice(1);let active=true;fetch(`/api/sharing${id?`?id=${encodeURIComponent(id)}`:''}`,{headers:invitation?{'x-collection-invite':invitation}:{}}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(active){setRows(d.result);setCode(invitation);setLoaded(true);}}).catch(e=>{if(active){setError(e.message);setLoaded(true);}});return()=>{active=false;};},[id]);
  return <main className="collections collection-public"><Link href="/">PulsHealth</Link><div className="collection-heading"><div><div className="eyebrow">{id?'You’re invited':'Browse opportunities'}</div><h1>{id?'Your data. Your decision.':'Contribute to something you choose.'}</h1><p>{id?'Review who is asking, what they need, and how your contribution will be used.':'Optional programs and studies accepting volunteers. Listing review is not an endorsement or ethics approval.'}</p></div></div>
    {error&&<p role="alert">{error}</p>}{!loaded&&<p>Loading requests…</p>}{loaded&&!error&&!rows.length&&<div className="panel collection-detail"><h2>{id?'This invitation is unavailable.':'No opportunities listed yet.'}</h2><p>{id?'Ask the organizer for a current invitation.':'You can still join a request through an invitation.'}</p></div>}
    {rows.map(r=><section className="panel collection-detail" key={r.id}><RequestSummary request={r}/>{id?<><p className="collection-small">Approve in the iPhone app. Choose optional types before sharing. Contributions are separate from your personal sync. Stop at any time; previously downloaded copies cannot be recalled.</p><a className="btn primary" href={`puls://collection?id=${r.id}${code?`&invite=${encodeURIComponent(code)}`:''}`}>Review in PulsHealth</a></>:<Link href={`/collect/${r.id}`} className="btn">Review request →</Link>}</section>)}
  </main>;
}
