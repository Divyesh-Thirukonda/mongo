"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Box, Check, CheckCheck, ChevronDown, ChevronRight, CircleCheck, Code2, Command, CornerDownRight, FileCode2, Files, GitBranch, GitMerge, Layers3, Link2, Loader2, MessageSquare, PanelLeftClose, PanelRight, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, Sparkles, SquareTerminal, TriangleAlert, Users, X } from "lucide-react";
import { PEOPLE, type Artifact, type Intent, type MemoryCheckpoint, type PersonId, type Session, type SessionSnapshot, type TrajectoryEvent } from "@/lib/types";

type InspectorTab = "plan" | "changes" | "memory";
type DesktopWindow = Window & { convergeDesktop?: { isDesktop: boolean; openCollaboratorWindow: () => Promise<unknown> } };
type ActivityItem = { type: "intent"; value: Intent } | { type: "event"; value: TrajectoryEvent };
const STARTERS = [
  { personId: "alex" as PersonId, text: "Connect Stripe and display the product catalog", label: "Build the foundation", icon: Box },
  { personId: "sam" as PersonId, text: "Add NEW to the 3 most recently added Stripe products", label: "Add another perspective", icon: Sparkles },
];
const RELATIONS = { start: "New direction", extend: "Extends the plan", depend: "Builds on earlier work", duplicate: "Already covered", conflict: "Decision needed", parallel: "Parallel work" };

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), cache: "no-store", signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status}). Please try again.`);
  if (data === null) throw new Error("The server returned an unreadable response. Please try again.");
  return data as T;
}
function person(id: string) { return PEOPLE.find((entry) => entry.id === id) ?? PEOPLE[0]; }
function shortTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function shortDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric" }); }
function Avatar({ id, small = false }: { id: PersonId; small?: boolean }) { const p = person(id); return <span className={`avatar ${small ? "small" : ""}`} style={{ "--avatar-color": p.color } as React.CSSProperties}>{p.initials}</span>; }
function ConvergeMark({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 6v5c0 6 5 10 13 10h5M7 26v-5c0-6 5-10 13-10h5" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/><path d="m21 7 4 4-4 4m0 2 4 4-4 4" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

export default function Workspace() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [health, setHealth] = useState<{ database: { connected: boolean }; engine: string } | null>(null);
  const [personId, setPersonId] = useState<PersonId>("alex");
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<InspectorTab>("plan");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [ready, setReady] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentIdRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const refreshRef = useRef<() => void>(() => {});
  const newSessionRef = useRef<() => void>(() => {});
  const pendingSubmission = useRef<{ sessionId: string; personId: PersonId; text: string; requestId: string } | null>(null);

  const loadSessions = useCallback(async () => {
    try { const result = await api<{ sessions: Session[] }>("/api/sessions"); setSessions(result.sessions); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load workspaces."); }
    finally { setListLoading(false); }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setDesktop(Boolean((window as DesktopWindow).convergeDesktop?.isDesktop));
    const requestedPerson = query.get("person");
    if (PEOPLE.some((entry) => entry.id === requestedPerson)) setPersonId(requestedPerson as PersonId);
    const requestedSession = query.get("session");
    if (requestedSession) { currentIdRef.current = requestedSession; setSessionId(requestedSession); }
    setReady(true);
    void loadSessions();
    void api<{ database: { connected: boolean }; engine: string }>("/api/health").then(setHealth).catch(() => {});
    const onPop = () => { const next = new URLSearchParams(window.location.search); const id = next.get("session"); currentIdRef.current = id; setSessionId(id); const author = next.get("person"); if (PEOPLE.some((entry) => entry.id === author)) setPersonId(author as PersonId); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadSessions]);

  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set("session", sessionId); else url.searchParams.delete("session");
    url.searchParams.set("person", personId);
    window.history.replaceState({}, "", url);
  }, [sessionId, personId, ready]);

  useEffect(() => {
    currentIdRef.current = sessionId;
    if (!sessionId) { setSnapshot(null); setLoading(false); setConnectionError(null); return; }
    const controller = new AbortController();
    let disposed = false;
    let fetching = false;
    setLoading(true);
    setSnapshot(null);
    atBottomRef.current = true;
    const refresh = async () => {
      if (fetching || disposed) return;
      fetching = true;
      try {
        const data = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}`, undefined, controller.signal);
        if (disposed) return;
        setSnapshot(data); setConnectionError(null);
        setSessions((items) => [data.session, ...items.filter((entry) => entry.id !== data.session.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      } catch (cause) { if (!disposed) setConnectionError(cause instanceof Error ? cause.message : "Connection interrupted."); }
      finally { fetching = false; if (!disposed) setLoading(false); }
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
    stream.addEventListener("change", refreshRef.current);
    // Polling also refreshes worker health and presence if an event stream is interrupted.
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
    return () => { disposed = true; controller.abort(); stream.close(); window.clearInterval(timer); refreshRef.current = () => {}; };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const ping = () => { void api(`/api/sessions/${encodeURIComponent(sessionId)}/presence`, { personId }).catch(() => {}); };
    ping(); const timer = window.setInterval(ping, 20000);
    return () => window.clearInterval(timer);
  }, [sessionId, personId]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShareOpen(false); setSidebarOpen(false); setInspectorOpen(false); }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((open) => !open); setSidebarOpen(true); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); newSessionRef.current(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const activity = useMemo<ActivityItem[]>(() => {
    if (!snapshot) return [];
    const intentIds = new Set(snapshot.intents.map((intent) => intent.id));
    const events = snapshot.events.filter((event) => !(["intent", "routing", "merge", "conflict"].includes(event.kind) && event.intentIds.some((id) => intentIds.has(id))));
    return [...snapshot.intents.map((value): ActivityItem => ({ type: "intent", value })), ...events.map((value): ActivityItem => ({ type: "event", value }))].sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt) || (a.type !== b.type ? a.type === "intent" ? -1 : 1 : a.type === "event" && b.type === "event" ? a.value.sequence - b.value.sequence : a.value.id.localeCompare(b.value.id)));
  }, [snapshot]);
  useEffect(() => {
    if (atBottomRef.current) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
    else if (activity.length) setShowJump(true);
  }, [activity.length, snapshot?.session.revision]);

  const selectSession = (id: string) => { currentIdRef.current = id; setSessionId(id); setError(null); setSidebarOpen(false); setShareOpen(false); setDraft(""); };
  const createSession = async () => { const data = await api<{ session: Session }>("/api/sessions", {}); setSessions((items) => [data.session, ...items]); selectSession(data.session.id); return data.session.id; };
  const newSession = async () => { if (busy) return; setBusy("create"); setError(null); try { await createSession(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a session."); } finally { setBusy(null); } };
  newSessionRef.current = () => { void newSession(); };
  const submit = async (text = draft, authorId = personId) => {
    if (!text.trim() || busy) return;
    setBusy("send"); setError(null);
    try {
      const id = sessionId ?? await createSession();
      const existing = pendingSubmission.current;
      const clientRequestId = existing?.sessionId === id && existing.personId === authorId && existing.text === text ? existing.requestId : crypto.randomUUID();
      pendingSubmission.current = { sessionId: id, personId: authorId, text, requestId: clientRequestId };
      await api(`/api/sessions/${encodeURIComponent(id)}/intents`, { text: text.trim(), authorId, clientRequestId });
      pendingSubmission.current = null; setDraft(""); setPersonId(authorId);
      if (currentIdRef.current === id) refreshRef.current();
      atBottomRef.current = true;
    } catch (cause) { setDraft(text); setError(cause instanceof Error ? cause.message : "Your message could not be sent."); }
    finally { setBusy(null); textareaRef.current?.focus(); }
  };
  const control = async (action: "pause" | "resume" | "retry") => { if (!sessionId || busy) return; setBusy(action); setError(null); try { await api(`/api/sessions/${encodeURIComponent(sessionId)}/control`, { action }); refreshRef.current(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the session."); } finally { setBusy(null); } };
  const resolve = async (intentId: string, choice: "keep-existing" | "replace-existing") => { if (!sessionId || busy) return; setBusy(intentId); setError(null); try { await api(`/api/sessions/${encodeURIComponent(sessionId)}/resolve`, { intentId, choice }); refreshRef.current(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resolve the conflict."); } finally { setBusy(null); } };
  const shareUrl = (asPerson = personId) => { const url = new URL(window.location.href); if (sessionId) url.searchParams.set("session", sessionId); url.searchParams.set("person", asPerson); return url.toString(); };
  const copyLink = async () => { try { await navigator.clipboard.writeText(shareUrl()); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { setError("Clipboard access is unavailable. Copy the session URL from your address bar."); } };
  const openCollaborator = async () => {
    const shell = (window as DesktopWindow).convergeDesktop;
    if (shell) {
      try { await shell.openCollaboratorWindow(); setShareOpen(false); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open the collaborator window."); }
    } else window.open(shareUrl(personId === "sam" ? "alex" : "sam"), "_blank", "noopener,noreferrer");
  };
  const toggleInspector = () => { if (window.matchMedia("(max-width: 1000px)").matches) setInspectorOpen(!inspectorOpen); else setInspectorCollapsed(!inspectorCollapsed); };

  const session = snapshot?.session;
  const onlinePeople = snapshot?.presence.filter((entry) => Date.now() - new Date(entry.seenAt).getTime() < 45000).map((entry) => entry.personId) ?? [];
  const isWorking = session?.status === "running" || session?.status === "planning";
  const filteredSessions = sessions.filter((entry) => `${entry.name} ${entry.goal}`.toLowerCase().includes(search.toLowerCase()));
  const storageConnected = (snapshot?.storage.connected ?? health?.database.connected) === true && !connectionError;

  return <div className={`converge-app ${desktop ? "desktop-shell" : ""}`}>
    <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`} aria-label="Workspace navigation">
      <div className="sidebar-brand"><div className="brand-icon"><ConvergeMark size={23}/></div><span>converge</span><button className="icon-button sidebar-dismiss" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={16}/></button><span className="workspace-shortcut">⌘ K</span></div>
      <button className="team-switcher" onClick={() => { setSearchOpen(false); document.getElementById("team-section")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}><span className="team-logo"><Layers3 size={17}/></span><span>Acme workspace<small>Shared development</small></span><ChevronDown size={14}/></button>
      <div className="sidebar-actions"><button onClick={() => void newSession()} disabled={!!busy}><Plus size={17}/><span>New session</span><span className="key-hint">⌘ N</span></button><button onClick={() => setSearchOpen(!searchOpen)}><Search size={16}/><span>Find a session</span></button></div>
      {searchOpen && <label className="session-search"><Search size={13}/><input autoFocus placeholder="Search sessions…" value={search} onChange={(event) => setSearch(event.target.value)}/></label>}
      <div className="sidebar-section-heading"><span>SESSIONS</span><button className="icon-button" aria-label="Refresh sessions" onClick={() => void loadSessions()}><RefreshCw size={12}/></button></div>
      <nav className="session-list" aria-label="Sessions">{listLoading ? <div className="sidebar-loading"><Loader2 className="spin" size={14}/>Loading sessions</div> : filteredSessions.length ? filteredSessions.map((entry) => <button key={entry.id} className={`session-link ${entry.id === sessionId ? "selected" : ""}`} onClick={() => selectSession(entry.id)}><MessageSquare size={15}/><span>{entry.name || "Untitled session"}<small>{entry.goal || "Ready for a direction"}</small></span>{["planning", "running"].includes(entry.status) ? <span className="tiny-dot working"/> : entry.status === "blocked" || entry.status === "error" ? <span className="tiny-dot warning"/> : null}</button>) : <p className="sidebar-empty">{search ? "No matching sessions." : "A shared idea starts here."}</p>}</nav>
      <div className="sidebar-team" id="team-section"><div className="sidebar-section-heading"><span>YOUR TEAM</span><span className="team-count">{PEOPLE.length}</span></div>{PEOPLE.map((entry) => <button key={entry.id} className={`team-person ${personId === entry.id ? "selected-person" : ""}`} onClick={() => setPersonId(entry.id)} aria-label={`Post as ${entry.name}`}><Avatar id={entry.id} small/><span>{entry.name}<small>{entry.role}</small></span>{onlinePeople.includes(entry.id) ? <span className="tiny-dot online" title="Present in this session"/> : personId === entry.id ? <Check size={12}/> : null}</button>)}</div>
      <div className="sidebar-bottom"><div className="environment"><span className="environment-icon"><GitBranch size={14}/></span><span>Shared workspace<small>One agent. One working tree.</small></span></div><span className="sidebar-footnote"><ConvergeMark size={12}/>Made for working together<span>v0.1</span></span></div>
    </aside>
    {sidebarOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}/>}

    <main className="main-workspace">
      <header className="session-header"><div className="session-heading"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Layers3 size={18}/></button><span className="breadcrumb">Workspace</span><ChevronRight size={12}/><h1>{session?.name || (sessionId ? "Shared session" : "New session")}</h1>{session && <span className={`session-state state-${session.status}`}><span className="tiny-dot"/>{session.status === "complete" ? "Up to date" : session.status === "running" ? "Working" : session.status === "planning" ? "Planning" : session.status === "idle" ? "Ready" : session.status}</span>}</div><div className="header-actions">{onlinePeople.length > 0 && <div className="presence-avatars" aria-label={`${onlinePeople.length} people present`}>{[...new Set(onlinePeople)].map((id) => <Avatar key={id} id={id} small/>)}</div>}<div className="share-wrap"><button className="share-button" disabled={!sessionId} onClick={() => setShareOpen(!shareOpen)}><Users size={14}/><span>Share session</span></button>{shareOpen && <div className="share-popover"><strong>A shared place to build.</strong><p>Open this session as another teammate. Everyone sees the same direction.</p><button onClick={() => void copyLink()}>{copied ? <Check size={14}/> : <Link2 size={14}/>} {copied ? "Link copied" : "Copy session link"}</button><button onClick={() => void openCollaborator()}><ArrowUpRight size={14}/>{desktop ? "Open collaborator window" : `Open as ${personId === "sam" ? "Alex" : "Sam"}`}</button></div>}</div><button className={`icon-button inspector-toggle ${inspectorOpen ? "selected" : ""}`} aria-label="Toggle session details" onClick={toggleInspector}><PanelRight size={18}/></button></div></header>

      {(error || connectionError || session?.error) && <div className="error-banner" role="alert"><TriangleAlert size={15}/><span>{error || connectionError || session?.error}</span>{error ? <button aria-label="Dismiss error" onClick={() => setError(null)}><X size={14}/></button> : <button onClick={() => refreshRef.current()}><RefreshCw size={13}/>Retry</button>}</div>}
      <div className="workspace-columns">
        <section className="conversation-column" aria-label="Shared session conversation">
          <div className="conversation-context"><div><span className="live-indicator"><span className={`tiny-dot ${snapshot?.worker.online ? "online" : ""}`}/>{snapshot ? snapshot.worker.online ? "Agent online" : "Agent offline" : "Shared agent"}</span><span className="context-separator">/</span><span>{session?.codexThreadId ? "Persistent session" : "All perspectives, one thread"}</span></div>{session && <button className="quiet-button" disabled={!!busy || !["planning", "running", "paused", "error"].includes(session.status)} onClick={() => void control(session.status === "paused" ? "resume" : session.status === "error" ? "retry" : "pause")}>{session.status === "paused" ? <Play size={12}/> : session.status === "error" ? <RefreshCw size={12}/> : <Pause size={12}/>} {session.status === "paused" ? "Resume" : session.status === "error" ? "Retry" : session.pauseRequested ? "Pausing…" : "Pause"}</button>}</div>
          <div className="transcript" ref={transcriptRef} onScroll={(event) => { const element = event.currentTarget; atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; if (atBottomRef.current) setShowJump(false); }}>
            {loading && !snapshot ? <div className="loading-session"><Loader2 size={20} className="spin"/><p>Opening the shared workspace…</p></div> : activity.length === 0 ? <div className="empty-workspace"><div className="empty-constellation"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="constellation-person person-a"><Avatar id="alex"/></span><span className="constellation-person person-b"><Avatar id="sam"/></span><span className="constellation-person person-c"><Avatar id="jordan"/></span><span className="constellation-mark"><ConvergeMark size={35}/></span><span className="constellation-spark"><Sparkles size={12}/></span></div><div className="empty-eyebrow">A LITTLE LESS BACK-AND-FORTH</div><h2>Different minds.<br/>One direction.</h2><p>Bring your team’s ideas into one coding session.<br/>Your agent finds the connections and builds the whole picture.</p><div className="starter-heading"><span>Try it together</span><div/></div><div className="starter-prompts">{STARTERS.map((starter, index) => <button key={starter.personId} disabled={!!busy} onClick={() => { setPersonId(starter.personId); setDraft(starter.text); textareaRef.current?.focus(); }}><span className="starter-number">0{index + 1}</span><span><small>{starter.label}<span>as {person(starter.personId).name.split(" ")[0]}</span></small><strong>{starter.text}</strong></span><ArrowUpRight size={15}/></button>)}</div><span className="empty-fineprint"><GitMerge size={12}/>Two requests. A shared plan. No duplicated effort.</span></div> : <div className="activity-list"><div className="thread-start"><span/>{session ? shortDate(session.createdAt) : "Today"}<span/></div>{activity.map((item) => item.type === "intent" ? <IntentCard key={`intent-${item.value.id}`} intent={item.value} disabled={!!busy} onResolve={resolve}/> : <AgentEvent key={`event-${item.value.id}`} event={item.value}/>)}{isWorking && <div className="working-indicator"><span className="agent-avatar"><ConvergeMark size={15}/></span><span className="thinking-dots"><i/><i/><i/></span><span>{session?.status === "planning" ? "Finding a shared direction" : "Working on the shared plan"}</span></div>}</div>}
          </div>
          {showJump && <button className="jump-button" onClick={() => { atBottomRef.current = true; setShowJump(false); transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={13}/>Latest activity</button>}
          <div className="composer-area"><form className={`composer ${busy === "send" ? "sending" : ""}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}><textarea ref={textareaRef} disabled={busy === "send" || busy === "create"} aria-label="Add your direction" placeholder={sessionId ? "Add your perspective, or steer the work…" : "What should we build together?"} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={5000} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/><div className="composer-toolbar"><label className="person-select"><Avatar id={personId} small/><select aria-label="Posting as" disabled={busy === "send" || busy === "create"} value={personId} onChange={(event) => setPersonId(event.target.value as PersonId)}>{PEOPLE.map((entry) => <option key={entry.id} value={entry.id}>{entry.name.split(" ")[0]}</option>)}</select><ChevronDown size={12}/></label><span className="composer-hint">Adding to the shared direction</span><div className="composer-right">{draft.length > 4000 && <small>{draft.length}/5000</small>}<button className="send-button" type="submit" disabled={!draft.trim() || !!busy} aria-label="Send direction">{busy === "send" || busy === "create" ? <Loader2 size={17} className="spin"/> : <ArrowUp size={18}/>}</button></div></div></form><div className="composer-footer"><span><Command size={10}/>Enter to send<span className="footer-dot">·</span>Shift + Enter for a new line</span><span><ShieldCheck size={11}/>Shared context</span></div></div>
        </section>

        <aside className={`inspector ${inspectorOpen ? "inspector-open" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""}`} aria-label="Session details"><div className="inspector-tabs" role="tablist" aria-label="Session detail panels">{(["plan", "changes", "memory"] as const).map((value) => <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value === "plan" ? "Shared plan" : value === "changes" ? "Changes" : "Memory"}{value === "changes" && session?.artifact?.files.length ? <span>{session.artifact.files.length}</span> : null}</button>)}<button className="icon-button close-inspector" aria-label="Close session details" onClick={() => setInspectorOpen(false)}><X size={15}/></button></div><div className="inspector-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>{tab === "plan" ? <PlanPanel session={session} intents={snapshot?.intents ?? []} onChanges={() => setTab("changes")}/> : tab === "changes" ? <ChangesPanel artifact={session?.artifact}/> : <MemoryPanel checkpoints={snapshot?.checkpoints ?? []} session={session}/>}</div><div className="inspector-footer"><div><span className={`tiny-dot ${storageConnected ? "online" : ""}`}/>{snapshot || health ? storageConnected ? snapshot ? "Saved to Atlas" : "Atlas connected" : "Atlas unavailable" : "Connecting to Atlas…"}</div><span>{session ? `REV ${session.revision}` : "CONVERGE"}</span></div></aside>
      </div>
    </main>
  </div>;
}

function IntentCard({ intent, disabled, onResolve }: { intent: Intent; disabled: boolean; onResolve: (id: string, choice: "keep-existing" | "replace-existing") => Promise<void> }) {
  const author = person(intent.authorId);
  const conflicting = intent.status === "blocked" && intent.decision?.relation === "conflict";
  return <article className={`intent-card ${conflicting ? "has-conflict" : ""}`}><div className="intent-author"><Avatar id={intent.authorId} small/><strong>{author.name.split(" ")[0]}</strong><span>{author.role}</span><time dateTime={intent.createdAt}>{shortTime(intent.createdAt)}</time>{intent.status === "fulfilled" && <span className="intent-fulfilled"><CheckCheck size={12}/>Fulfilled</span>}</div><div className="intent-bubble"><p>{intent.text}</p></div>{intent.decision ? <div className={`intent-routing relation-${intent.decision.relation}`}><div className="routing-label">{conflicting ? <TriangleAlert size={12}/> : intent.decision.relation === "duplicate" ? <CheckCheck size={12}/> : <GitMerge size={12}/>}<span>{RELATIONS[intent.decision.relation]}</span>{intent.decision.parentIntentIds.length > 0 && <span className="routing-parent">{intent.decision.parentIntentIds.length} linked {intent.decision.parentIntentIds.length === 1 ? "intent" : "intents"}</span>}</div><p>{intent.decision.summary}</p>{conflicting ? <div className="conflict-options"><p>{intent.decision.reason}</p><div><button disabled={disabled} onClick={() => void onResolve(intent.id, "keep-existing")}>Keep current direction</button><button disabled={disabled} onClick={() => void onResolve(intent.id, "replace-existing")}>Use this direction<ArrowRight size={12}/></button></div></div> : <details className="routing-reason"><summary>Why this fits<ChevronDown size={10}/></summary><p>{intent.decision.reason}</p></details>}</div> : <div className="intent-pending"><span className="tiny-dot working"/>{intent.status === "queued" ? "Finding where this fits…" : intent.status}</div>}{intent.resolution && <div className="resolved-note"><Check size={11}/>{intent.resolution === "keep-existing" ? "Current direction kept" : "New direction selected"}</div>}</article>;
}

function AgentEvent({ event }: { event: TrajectoryEvent }) {
  const Icon = event.kind === "tool" ? SquareTerminal : event.kind === "verification" ? ShieldCheck : event.kind === "checkpoint" ? Layers3 : event.kind === "conflict" ? TriangleAlert : event.kind === "merge" ? GitMerge : ConvergeMark;
  if (event.kind === "agent") return <article className="agent-message"><div className="agent-message-heading"><span className="agent-avatar"><ConvergeMark size={14}/></span><strong>Converge</strong><span>{event.actor !== "agent" && event.actor !== "codex" ? event.actor : "Agent"}</span><time>{shortTime(event.createdAt)}</time></div>{event.title && <h3>{event.title}</h3>}{event.detail && event.detail !== event.title && <p>{event.detail}</p>}</article>;
  return <details className={`trajectory-event event-${event.kind}`}><summary><span className="trajectory-icon"><Icon size={14}/></span><span className="trajectory-title">{event.title}</span>{event.kind === "checkpoint" ? <span className="event-mini-label">Memory</span> : null}<time>{shortTime(event.createdAt)}</time><ChevronRight size={11}/></summary>{event.detail && <pre className="event-detail">{event.detail}</pre>}{event.intentIds.length > 0 && <span className="event-linked">{event.intentIds.length} linked {event.intentIds.length === 1 ? "intent" : "intents"}</span>}</details>;
}

function PlanPanel({ session, intents, onChanges }: { session?: Session; intents: Intent[]; onChanges: () => void }) {
  const steps = session?.plan.steps ?? [];
  const done = steps.filter((step) => step.status === "done").length;
  return <><div className="panel-eyebrow"><GitMerge size={13}/>ONE SHARED DIRECTION</div><h2 className="panel-title">The whole picture.</h2><p className="panel-intro">{session?.plan.summary || "Your team’s requests come together here. A shared plan keeps everyone moving in the same direction."}</p>{steps.length ? <div className="plan-progress"><div><span>Implementation</span><span>{done} / {steps.length}</span></div><div className="progress-track"><i style={{ width: `${done / steps.length * 100}%` }}/></div></div> : null}<div className="plan-steps">{steps.map((step, index) => <div className={`plan-step step-${step.status}`} key={step.id}><span className="step-status">{step.status === "done" ? <Check size={12}/> : step.status === "running" ? <Loader2 size={13} className="spin"/> : step.status === "blocked" ? <TriangleAlert size={12}/> : <span>{index + 1}</span>}</span><div><h3>{step.title}</h3><div className="step-attribution">{[...new Set(step.intentIds.map((id) => intents.find((intent) => intent.id === id)?.authorId).filter((id): id is PersonId => !!id))].map((id) => <span key={id}><i style={{ background: person(id).color }}/>{person(id).name.split(" ")[0]}</span>)}{step.dependsOn.length > 0 && <small><CornerDownRight size={10}/>{step.dependsOn.length} prerequisite{step.dependsOn.length > 1 ? "s" : ""}</small>}</div></div></div>)}</div>{steps.length === 0 && <div className="plan-empty-visual"><div className="plan-placeholder-line"><span/><i/></div><div className="plan-placeholder-line"><span/><i/></div><div className="plan-placeholder-line"><span/><i/></div><p>The plan appears with your first direction.</p></div>}{session?.plan.constraints.length ? <section className="panel-section"><h3><Layers3 size={13}/>Shared constraints</h3>{session.plan.constraints.map((constraint, index) => <div className="constraint" key={`${constraint.intentId}-${index}`}><Avatar id={constraint.authorId} small/><p>{constraint.text}</p></div>)}</section> : null}{session?.artifact ? <section className="panel-section"><div className="panel-section-heading"><h3><Box size={13}/>What’s taking shape</h3><button className="text-link" onClick={onChanges}>View changes<ArrowUpRight size={11}/></button></div><ProductPreview artifact={session.artifact}/></section> : null}{session && <div className="session-facts"><span><GitMerge size={12}/>{session.metrics.mergedIntents} intents merged</span><span><SquareTerminal size={12}/>{session.metrics.turns} agent turns</span></div>}</>;
}

function ProductPreview({ artifact }: { artifact: Artifact }) {
  return <div className="product-preview"><div className="preview-browser"><span className="preview-dots"><i/><i/><i/></span><span><Box size={9}/>catalog / preview</span><ArrowUpRight size={11}/></div><div className="catalog-heading"><span>THE EVERYDAY EDIT</span><h4>Good things, simply made.</h4></div>{artifact.products.length ? <div className="product-grid">{artifact.products.slice(0, 6).map((product, index) => <div className="product" key={product.id}><div className={`product-object object-${index % 6}`}>{product.badge && <span className="product-badge">{product.badge}</span>}<span className="product-shape"><Box size={30} strokeWidth={1}/></span></div><h5>{product.name}</h5><span>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(product.price)}</span></div>)}</div> : <div className="catalog-empty"><Box size={22}/><p>No products in the current artifact.</p></div>}<div className="preview-disclaimer"><span className={`tiny-dot ${artifact.stripeConnected ? "online" : ""}`}/>{artifact.stripeConnected ? "Stripe-compatible fixture" : "Catalog fixture preview"}<span>Not a live store</span></div></div>;
}

function ChangesPanel({ artifact }: { artifact?: Artifact }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [view, setView] = useState<"diff" | "preview">("diff");
  const activeFile = selectedFile && artifact?.files.some((file) => file.path === selectedFile) ? selectedFile : null;
  const diff = useMemo(() => { if (!artifact?.diff || !activeFile) return artifact?.diff ?? ""; const chunks = artifact.diff.split(/(?=^diff --git )/m); return chunks.find((chunk) => chunk.split("\n")[0]?.includes(activeFile)) ?? artifact.diff; }, [artifact?.diff, activeFile]);
  if (!artifact) return <div className="inspector-empty"><span><Files size={25} strokeWidth={1.3}/></span><h2>Work you can inspect.</h2><p>Actual file changes, checks, and a preview will appear as the agent builds.</p><div className="empty-panel-note"><Code2 size={12}/>Every change has a shared intent.</div></div>;
  const passed = artifact.checks.filter((check) => check.passed).length;
  return <><div className="changes-heading"><div className="panel-eyebrow"><Files size={13}/>WORKING CHANGES</div><span>r{artifact.verifiedRevision}</span></div><div className="change-summary"><h2>{artifact.files.length} changed {artifact.files.length === 1 ? "file" : "files"}</h2><span className="diff-added">+{artifact.files.reduce((sum, file) => sum + file.additions, 0)}</span><span className="diff-removed">−{artifact.files.reduce((sum, file) => sum + file.deletions, 0)}</span></div><div className="file-list">{artifact.files.map((file) => <button key={file.path} className={activeFile === file.path ? "active" : ""} onClick={() => { setSelectedFile(activeFile === file.path ? null : file.path); setView("diff"); }}><FileCode2 size={13}/><span>{file.path}</span><small className="diff-added">+{file.additions}</small>{file.deletions > 0 && <small className="diff-removed">−{file.deletions}</small>}</button>)}</div><div className="artifact-view-tabs"><button onClick={() => setView("diff")} className={view === "diff" ? "active" : ""}><Code2 size={12}/>Diff</button><button onClick={() => setView("preview")} className={view === "preview" ? "active" : ""}><Box size={12}/>Preview</button></div>{view === "preview" ? <ProductPreview artifact={artifact}/> : diff ? <div className="diff-view" aria-label={activeFile ? `Diff for ${activeFile}` : "Code diff"}><div className="diff-file-label">{activeFile || "All changes"}</div><pre>{diff.split("\n").map((line, index) => <div key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""}><span className="line-number">{index + 1}</span><code>{line || " "}</code></div>)}</pre></div> : <p className="panel-muted">No textual diff was returned for this revision.</p>}<section className="panel-section checks-section"><div className="panel-section-heading"><h3><ShieldCheck size={13}/>Verification</h3><span>{passed}/{artifact.checks.length} passed</span></div>{artifact.checks.length ? artifact.checks.map((check, index) => <details className={`check-row ${check.passed ? "passed" : "failed"}`} key={`${check.name}-${index}`}><summary>{check.passed ? <CircleCheck size={14}/> : <TriangleAlert size={14}/>}<span>{check.name}</span><ChevronRight size={11}/></summary><p>{check.detail}</p></details>) : <p className="panel-muted">No checks reported yet.</p>}</section><p className="artifact-timestamp">Artifact updated {shortTime(artifact.updatedAt)}</p></>;
}

function MemoryPanel({ checkpoints, session }: { checkpoints: MemoryCheckpoint[]; session?: Session }) {
  return <><div className="panel-eyebrow"><Layers3 size={13}/>THE CONTEXT YOU SHARE</div><h2 className="panel-title">Nothing gets lost.</h2><p className="panel-intro">Decisions and intent stay with the session, so the team can keep moving without starting over.</p>{session && <div className="memory-stat-row"><div><strong>{session.metrics.contextChars.toLocaleString()}</strong><span>context characters</span></div><div><strong>{session.metrics.archivedEvents}</strong><span>archived events</span></div></div>}{checkpoints.length ? <div className="checkpoint-list">{[...checkpoints].reverse().map((checkpoint) => <article className="checkpoint" key={checkpoint.id}><div className="checkpoint-heading"><span><Layers3 size={13}/>Checkpoint</span><small>r{checkpoint.revision}</small><time>{shortTime(checkpoint.createdAt)}</time></div><p>{checkpoint.summary}</p>{checkpoint.decisions.length > 0 && <details><summary>{checkpoint.decisions.length} preserved decisions<ChevronDown size={11}/></summary><ul>{checkpoint.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul></details>}<div className="checkpoint-meta"><span>{checkpoint.intentIds.length} intents</span><span>{checkpoint.eventCount} events</span><span>{checkpoint.contextChars.toLocaleString()} chars</span></div></article>)}</div> : <div className="memory-empty"><Layers3 size={28} strokeWidth={1.2}/><h3>A fresh page.</h3><p>When the agent saves a checkpoint, you’ll see the shared context and decisions here.</p></div>}{session?.codexThreadId && <div className="thread-reference"><SquareTerminal size={12}/><span>Persistent agent thread<code>{session.codexThreadId.slice(0, 18)}…</code></span></div>}</>;
}
