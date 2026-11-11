"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Activity, ArrowLeft, Check, CheckCircle2, ChevronRight, Copy, Database, Heart,
  Link as LinkIcon, Moon, Plus, ShieldCheck, Smartphone, Users, X } from "lucide-react";
import { dateLabel, PREVIEW_GROUPS, previewInvite, setMetric, validDraft,
  type GroupPreview, type MembershipPreview } from "@/lib/group-preview";
import styles from "./group-preview.module.css";

type View = "invitation" | "member" | "organizer" | "flows";
type Screen = "review" | "health" | "joined" | "groups" | "detail";
type Availability = "open" | "expired" | "ended" | "invalid";
const metricOptions = ["Steps", "Workouts", "Resting heart rate", "Sleep"];

function MetricIcon({ name }: { name: string }) {
  const Icon = name === "Sleep" ? Moon : name === "Resting heart rate" ? Heart : Activity;
  return <Icon size={19} aria-hidden="true" />;
}

function Summary({ group }: { group: GroupPreview }) {
  return <dl className={styles.summary}>
    <div><dt>Data dates</dt><dd>{dateLabel(group.start, "From the day you join")} {group.start && <>– {dateLabel(group.end, "ongoing")}</>}</dd></div>
    <div><dt>Sharing ends</dt><dd>{dateLabel(group.end, "No end date · until you leave")}</dd></div>
    <div><dt>Who can access it</dt><dd>{group.organizer}&apos;s group managers</dd></div>
    <div><dt>Stored with</dt><dd>{group.destination === "hosted" ? "PulsHealth · group access" : group.host}</dd></div>
    <div><dt>Data retention</dt><dd>{group.retention}</dd></div>
  </dl>;
}

function GroupMark({ small = false }: { small?: boolean }) {
  return <span className={`${styles.groupMark} ${small ? styles.smallMark : ""}`}><Users size={small ? 22 : 32} aria-hidden="true" /></span>;
}

const subscribeLocation = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};

export function GroupPreviewExperience() {
  const query = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "");
  const code = new URLSearchParams(query).get("invite");
  return <GroupPreviewSession key={query} initialCode={code} />;
}

function GroupPreviewSession({ initialCode }: { initialCode: string | null }) {
  const initialGroup = previewInvite(initialCode ?? "") ?? PREVIEW_GROUPS[0];
  const [view, setView] = useState<View>("invitation");
  const [group, setGroup] = useState(initialGroup);
  const [screen, setScreen] = useState<Screen>("review");
  const [installed, setInstalled] = useState(true);
  const [availability, setAvailability] = useState<Availability>(initialCode !== null && !previewInvite(initialCode) ? "invalid" : "open");
  const [selected, setSelected] = useState<string[]>(initialGroup.metrics);
  const [memberships, setMemberships] = useState<MembershipPreview[]>([]);
  const [health, setHealth] = useState("available");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [draft, setDraft] = useState<GroupPreview>({ ...PREVIEW_GROUPS[0], id: "custom-preview" });
  const [draftError, setDraftError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const active = memberships.find(item => item.group.id === group.id);

  useEffect(() => { heading.current?.focus(); }, [screen, view]);
  useEffect(() => {
    if (confirmLeave) leaveDialog.current?.showModal();
    else leaveDialog.current?.close();
  }, [confirmLeave]);

  function chooseGroup(next: GroupPreview) {
    setGroup(next); setSelected(next.metrics); setScreen("review"); setAvailability("open"); setNotice("");
  }

  function openMember() {
    setScreen(active ? "detail" : "review"); setView("member"); setNotice("");
  }

  function join() {
    if (!selected.length || health === "declined") {
      setNotice("You haven’t joined. Review your choices when you’re ready."); return;
    }
    const enabled = health === "partial" ? selected.slice(0, 1) : selected;
    if (!active) setMemberships(current => [...current, { group: { ...group }, enabled }]);
    setScreen("joined"); setNotice("");
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied preview link."); }
    catch { setNotice("Copy isn’t available here. Select the preview link below."); }
  }

  const nativeLink = `puls://group-preview?code=${encodeURIComponent(group.id)}`;
  const fixedExample = Boolean(previewInvite(group.id));
  const blocked = availability !== "open";
  const previewLink = `/groups/preview/?invite=${encodeURIComponent(group.id)}`;

  return <main className={styles.page}>
    <div className={styles.previewBar}>
      <span><span className={styles.previewDot} /> Groups concept</span>
      <span>UI preview. Synthetic examples. No health data is collected.</span>
      <button onClick={() => { setMemberships([]); chooseGroup(PREVIEW_GROUPS[0]); setDraft({ ...PREVIEW_GROUPS[0], id: "custom-preview" }); setView("invitation"); setInstalled(true); }}>Reset preview</button>
    </div>
    <nav className={styles.tabs} aria-label="Preview experience">
      {([['invitation', 'Invitation'], ['member', 'Member app'], ['organizer', 'Organizer'], ['flows', 'Experience map']] as const).map(([id, label]) =>
        <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); setNotice(""); }}>{label}</button>)}
    </nav>

    {(view === "invitation" || view === "member") && <div className={styles.scenarios}>
      <label>Example <select value={fixedExample ? group.id : "custom-preview"} onChange={event => chooseGroup(previewInvite(event.target.value)!)}>
        {!fixedExample && <option value="custom-preview">Your group draft</option>}
        {PREVIEW_GROUPS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Invitation <select value={availability} onChange={event => { setAvailability(event.target.value as Availability); setScreen("review"); }}>
        <option value="open">Open</option><option value="expired">Expired invite</option><option value="ended">Program ended</option><option value="invalid">Invalid link</option>
      </select></label>
      {view === "invitation" && <label className={styles.inlineCheck}><input type="checkbox" checked={installed} onChange={event => setInstalled(event.target.checked)} /> App installed</label>}
    </div>}

    {view === "invitation" && <section className={styles.invitationLayout}>
      <div className={styles.intro}>
        <div className={styles.people} aria-hidden="true"><span /><span /><span /></div>
        <h1 ref={heading} tabIndex={-1}>A little data.<br />A shared purpose.</h1>
        <p>Take part in a study, a class, or a healthier routine. Know what you share and who you share it with.</p>
        <div className={styles.assurance}><ShieldCheck size={22} /><span>Your personal database stays yours.<br />Each group has its own sharing choices.</span></div>
        <div className={styles.inviteChannels}><span>Email</span><span>Text</span><span>QR code</span><span>One invitation flow</span></div>
      </div>
      <article className={styles.inviteCard}>
        {blocked ? <>
          <GroupMark /><h2>{availability === "ended" ? "This program has ended" : availability === "expired" ? "This invitation has expired" : "Invitation unavailable"}</h2>
          <p>No data has been shared. Ask the organizer for a new invitation.</p>
          <button className={styles.secondary} onClick={() => { setAvailability("open"); }}>Try the open invitation</button>
        </> : <>
          <GroupMark /><p className={styles.organizer}>{group.organizer} invites you</p>
          <h2>{group.name}</h2><p>{group.purpose}</p>
          <div className={styles.requested}><h3>Requested data</h3>{group.metrics.map(metric => <span key={metric}><MetricIcon name={metric} />{metric}</span>)}</div>
          <Summary group={group} />
          {installed ? <button className={styles.primary} onClick={openMember}><Smartphone size={18} />Review in PulsHealth<ChevronRight size={18} /></button>
            : <>
              <a className={styles.primary} href="https://apps.apple.com/us/app/pulshealth/id6757657354">Get PulsHealth</a>
              <p className={styles.small}>After installing, return to this invitation. Your group isn’t joined automatically.</p>
              <button className={styles.secondary} onClick={openMember}>Try first-time joining</button>
              {fixedExample && <div className={styles.codeEntry}><span>Or enter this example code in the app</span><strong>{group.id}</strong></div>}
            </>}
          <p className={styles.small}>Review first. Nothing is shared until you join.</p>
          {fixedExample && <details className={styles.handoff}><summary>Test the native app handoff</summary>
            <p>Use a Debug build from this branch. The App Store version does not support this preview.</p>
            <a href={nativeLink}>Open preview invitation in the app</a>
            <Image unoptimized src={`/group-preview/${group.id}.svg`} width="150" height="150" alt={`Preview QR invitation for ${group.name}`} />
            <p>Scan with the iPhone Camera. This QR opens the branch’s synthetic invitation.</p>
          </details>}
        </>}
      </article>
    </section>}

    {view === "member" && <section className={styles.memberLayout}>
      <div className={styles.memberContext}>
        <h1 ref={heading} tabIndex={-1}>Your sharing,<br /> in one place.</h1>
        <p>Join once. Change your mind whenever you need to.</p>
        <ol className={styles.steps}>
          <li data-active={screen === "review"}><span>1</span><div><strong>Review the invitation</strong><p>The group, the data, the dates.</p></div></li>
          <li data-active={screen === "health"}><span>2</span><div><strong>Choose Health access</strong><p>Then confirm that you want to join.</p></div></li>
          <li data-active={["joined", "groups", "detail"].includes(screen)}><span>3</span><div><strong>Stay in control</strong><p>Turn data off or leave from Groups.</p></div></li>
        </ol>
        <button className={styles.textButton} onClick={() => { setScreen("groups"); setNotice(""); }}>View all sharing destinations <ChevronRight size={16} /></button>
        <p className={styles.small}>Browser preview only. Choices reset on reload.<br />The iOS preview lives in Sync → Groups preview.</p>
      </div>
      <div className={styles.phone}>
        <div className={styles.phoneBar}><span>PulsHealth</span><span>Groups preview</span></div>
        <div className={styles.phoneBody}>
          {blocked && screen === "review" ? <div className={styles.empty}>
            <LinkIcon /><h2>Invitation unavailable</h2><p>{availability === "ended" ? "The collection period has ended." : "Ask the organizer for a new invitation."} Nothing has been shared.</p>
            <button className={styles.secondary} onClick={() => setScreen("groups")}>Your groups</button>
          </div> : screen === "review" ? <>
            <button className={styles.back} onClick={() => setView("invitation")}><ArrowLeft size={17} />Invitation</button>
            {!installed && <p className={styles.welcome}>Welcome to PulsHealth. Let’s start with your group.</p>}
            <GroupMark /><h2>{group.name}</h2><p className={styles.organizer}>{group.organizer}</p><p>{group.purpose}</p>
            <h3>Data to share</h3><div className={styles.metricList}>{group.metrics.map(metric => <label key={metric}>
              <MetricIcon name={metric} /><span>{metric}</span><input type="checkbox" checked={selected.includes(metric)} onChange={event => setSelected(current => event.target.checked ? [...current, metric] : current.filter(item => item !== metric))} />
            </label>)}</div>
            <p className={styles.small}>The organizer sets the request. Uncheck anything you don’t want to share. This may affect participation.</p>
            <Summary group={group} />
            <p className={styles.small}>Leaving stops future sharing. It doesn’t erase data already received by the organizer.</p>
            <button className={styles.primary} disabled={!selected.length} onClick={() => { setScreen(active ? "detail" : "health"); setNotice(""); }}>{active ? "Manage group" : "Continue"}</button>
            {!selected.length && <p className={styles.small}>Select at least one type to continue.</p>}
          </> : screen === "health" ? <>
            <button className={styles.back} onClick={() => setScreen("review")}><ArrowLeft size={17} />Review</button>
            <Heart className={styles.healthIcon} size={42} /><h2>Choose Health access</h2>
            <p>iOS will ask what PulsHealth may read. You decide what’s available.</p>
            <div className={styles.healthMock}><strong>Simulate the Health step</strong><p>No Health permissions or data are accessed in this preview.</p>
              <label>Example response<select value={health} onChange={event => { setHealth(event.target.value); setNotice(""); }}><option value="available">Selected data available</option><option value="partial">Only first type available</option><option value="declined">Decline all access</option></select></label>
            </div>
            <p className={styles.small}>By joining, you agree to share {selected.join(", ").toLowerCase()} with {group.organizer} for the dates shown in your invitation.</p>
            <button className={styles.primary} onClick={join}>Join group</button>
            <button className={styles.textButton} onClick={() => { setScreen("groups"); setNotice("You haven’t joined. No data was shared."); }}>Not now</button>
          </> : screen === "joined" ? <div className={styles.success}>
            <CheckCircle2 size={54} /><h2>You’re in.</h2><p>{group.name}</p>
            <p>{health === "partial" ? "Only the first selected data type is enabled in this simulation." : "Your selected data is enabled in this simulation."}</p>
            <div className={styles.receipt}><Check size={17} />Joined in preview only. No data sent.</div>
            <button className={styles.primary} onClick={() => setScreen("groups")}>Your groups</button>
          </div> : screen === "groups" ? <>
            <h2>Your sharing</h2><p>Every destination has its own choices.</p>
            <h3>Groups</h3>
            {!memberships.length && <div className={styles.empty}><Users /><h3>No groups yet</h3><p>Open an invitation to get started.</p></div>}
            <div className={styles.memberships}>{memberships.map(item => <button key={item.group.id} onClick={() => { setGroup(item.group); setScreen("detail"); setNotice(""); }}>
              <GroupMark small /><span><strong>{item.group.name}</strong><small>{item.enabled.length ? `${item.enabled.length} data types selected` : "Sharing off"}</small></span><ChevronRight size={17} />
            </button>)}</div>
            <details className={styles.moreInvites}><summary><Plus size={17} />Try another invitation</summary>{PREVIEW_GROUPS.map(item => <button className={styles.textButton} key={item.id} onClick={() => chooseGroup(item)}>{item.name}</button>)}</details>
            <form className={styles.codeEntry} onSubmit={event => { event.preventDefault(); const found = previewInvite(code.trim()); if (found) chooseGroup(found); else setNotice("Invitation unavailable. Try move-together, sleep-study, or gym."); }}>
              <label htmlFor="invite-code">Have an invitation code?</label><div><input id="invite-code" value={code} onChange={event => setCode(event.target.value)} placeholder="Enter code" /><button className={styles.secondary}>Open</button></div>
            </form>
            <h3>Personal databases</h3><div className={styles.personal}><Database size={20} /><div><strong>My personal database</strong><small>Example connection · separate settings</small></div></div>
            <p className={styles.small}>Changing group sharing never changes your personal sync.</p>
          </> : <>
            <button className={styles.back} onClick={() => setScreen("groups")}><ArrowLeft size={17} />Your sharing</button>
            <GroupMark /><h2>{group.name}</h2><p>{group.organizer}</p>
            <div className={styles.status}>{active?.enabled.length ? "Sharing selected in preview" : "Sharing off"}</div>
            <h3>Shared data</h3><div className={styles.metricList}>{group.metrics.map(metric => <label key={metric}>
              <MetricIcon name={metric} /><span>{metric}</span><input type="checkbox" checked={active?.enabled.includes(metric) ?? false} onChange={event => setMemberships(current => current.map(item => item.group.id === group.id ? setMetric(item, metric, event.target.checked) : item))} />
            </label>)}</div>
            <p className={styles.small}>Changes apply to this group only. Turn everything off to pause sharing without leaving.</p>
            <Summary group={group} />
            <button className={styles.danger} onClick={() => setConfirmLeave(true)}>Leave group</button>
          </>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
        </div>
        <div className={styles.phoneNav}><span><Heart size={17} />Explore</span><span><Activity size={17} />Export</span><span className={styles.currentNav}><Database size={17} />Sync</span><span><Users size={17} />Settings</span></div>
      </div>
    </section>}

    {view === "organizer" && <section className={styles.organizerLayout}>
      <div><h1 ref={heading} tabIndex={-1}>One clear invitation.</h1><p>Choose what your group needs. Members see these details before deciding to join.</p>
        <div className={styles.organizerNote}><ShieldCheck /><p>Members can turn individual types off or leave at any time. A request is never permission to collect everything.</p></div>
        <h2>Keep the setup small</h2><p>A name, a purpose, data types, dates, and a destination. Email, text and QR all lead to the same invitation.</p>
        <div className={styles.sampleLinks}><h3>Try a sample invitation</h3>{PREVIEW_GROUPS.map(item => <button className={styles.textButton} key={item.id} onClick={() => { chooseGroup(item); setView("invitation"); }}>{item.name}<ChevronRight size={16} /></button>)}</div>
      </div>
      <form className={styles.organizerForm} onSubmit={event => { event.preventDefault(); if (!validDraft(draft)) { setDraftError(true); return; } setDraftError(false); chooseGroup({ ...draft, id: `custom-preview-${crypto.randomUUID()}`, metrics: [...draft.metrics] }); setView("invitation"); }}>
        <h2>Create a group</h2><p className={styles.small}>Local draft only. No group or invitation is published.</p>
        <label>Group name<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Organizer<input required maxLength={100} value={draft.organizer} onChange={event => setDraft({ ...draft, organizer: event.target.value })} /></label>
        <label>Why you’re collecting data<textarea required maxLength={300} value={draft.purpose} onChange={event => setDraft({ ...draft, purpose: event.target.value })} /></label>
        <fieldset><legend>Requested data</legend>{metricOptions.map(metric => <label className={styles.inlineCheck} key={metric}><input type="checkbox" checked={draft.metrics.includes(metric)} onChange={event => setDraft({ ...draft, metrics: event.target.checked ? [...draft.metrics, metric] : draft.metrics.filter(item => item !== metric) })} />{metric}</label>)}</fieldset>
        <div className={styles.dateFields}><label>Data from<input type="date" value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /><small>Blank means date of joining.</small></label><label>Sharing ends<input type="date" min={draft.start || undefined} value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /><small>Blank means until they leave.</small></label></div>
        <label>Destination<select value={draft.destination} onChange={event => setDraft({ ...draft, destination: event.target.value as GroupPreview["destination"] })}><option value="hosted">PulsHealth group access</option><option value="separate">Separate group database</option></select></label>
        {draft.destination === "separate" && <label>Database host<input required placeholder="research.example.org" value={draft.host === "PulsHealth · group access" ? "" : draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} /><small>Members see who receives their data. Connection setup follows later.</small></label>}
        <label>Previously received data is kept for<input required maxLength={160} value={draft.retention} onChange={event => setDraft({ ...draft, retention: event.target.value })} /></label>
        {draftError && <p role="alert" className={styles.notice}>Add a name, organizer, purpose, at least one type, valid dates, a host if needed, and a retention period.</p>}
        <button className={styles.primary}>Preview invitation</button>
      </form>
    </section>}

    {view === "flows" && <section className={styles.flows}>
      <h1 ref={heading} tabIndex={-1}>A short path in.<br />A clear way out.</h1>
      <p>One invitation, whether it arrives by email, text, link, or QR.</p>
      <div className={styles.flowRow}><div><LinkIcon /><strong>Invitation</strong><span>Who, why, what and when</span></div><ChevronRight /><div><Smartphone /><strong>Have the app?</strong><span>Open the group review</span></div><ChevronRight /><div><Heart /><strong>Health access</strong><span>Choose what iOS may read</span></div><ChevronRight /><div><CheckCircle2 /><strong>Join group</strong><span>Confirm selected sharing</span></div></div>
      <div className={styles.installPath}><span>No app yet?</span><strong>Get PulsHealth</strong><ChevronRight /><strong>Return to invitation or enter code</strong><ChevronRight /><strong>Group review</strong></div>
      <div className={styles.flowColumns}><article><h2>While you’re a member</h2><p>Sync → Groups → Your group</p><ul><li>See the exact requested data and dates.</li><li>Uncheck one type to stop sharing it.</li><li>Uncheck all types to pause this group.</li><li>Leave to stop future sharing for the group.</li></ul></article><article><h2>Separate destinations</h2><div className={styles.destinationFlow}><span>Your Apple Health</span><div><span>Personal database · your settings</span><span>Study · its request ∩ your consent</span><span>Gym · its request ∩ your consent</span></div></div></article></div>
      <p className={styles.small}>Production design: expired invitations cannot enroll; ended programs cannot receive new data. Policy expansions require fresh consent. Revocation must be enforced on the server and every upload path. Neither hosting model is implemented in this UI preview.</p>
    </section>}

    {view === "invitation" && fixedExample && !blocked && <div className={styles.sharePreview}><button className={styles.textButton} onClick={() => copy(`${window.location.origin}${previewLink}`)}><Copy size={16} />Copy sample invitation link</button>{notice && <span role="status">{notice}</span>}</div>}
    <dialog className={styles.dialog} ref={leaveDialog} onCancel={() => setConfirmLeave(false)} onClose={() => setConfirmLeave(false)}>
      <button className={styles.close} aria-label="Cancel leaving" onClick={() => setConfirmLeave(false)}><X size={20} /></button>
      <h2>Leave {group.name}?</h2><p>Future sharing stops for this group only. Your other groups and personal database keep their settings.</p><p>Data already received follows the organizer’s retention policy: {group.retention.toLowerCase()}. Contact the organizer to request deletion.</p>
      <button className={styles.danger} onClick={() => { setMemberships(current => current.filter(item => item.group.id !== group.id)); setConfirmLeave(false); setScreen("groups"); setNotice(`You left ${group.name} in this preview.`); }}>Leave group</button>
      <button className={styles.secondary} onClick={() => setConfirmLeave(false)}>Keep membership</button>
    </dialog>
  </main>;
}
