"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Box, Check, CheckCheck, ChevronDown, ChevronRight, CircleCheck, Code2, Command, CornerDownRight, FileCode2, Files, GitBranch, GitMerge, Layers3, Link2, Loader2, LogOut, MessageSquare, PanelLeftClose, PanelRight, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, SquareTerminal, TriangleAlert, Users, X } from "lucide-react";
import { type Artifact, type Intent, type MemoryCheckpoint, type Session, type SessionSnapshot, type TrajectoryEvent } from "@/lib/types";
import { authClient, type IdentityUser } from "@/lib/auth-client";
import { IntentGraph } from "@/components/intent-graph";

type InspectorTab = "activity" | "plan" | "changes" | "memory";
type Participant = { id: string; name: string; initials: string; color: string; isAnonymous: boolean };
type DesktopWindow = Window & { convergeDesktop?: { isDesktop: boolean; openCollaboratorWindow: (options: { url: string }) => Promise<unknown>; installCodexConnection?: (options: { sessionId: string; serverUrl: string; token: string }) => Promise<{ installed: true; name: string }> } };
type ActivityItem = { type: "intent"; value: Intent } | { type: "event"; value: TrajectoryEvent };
const RELATIONS = { start: "New request", extend: "Extends the plan", depend: "Depends on earlier work", duplicate: "Already covered", conflict: "Decision needed", parallel: "Parallel work" };
const EMPTY_PARTICIPANTS: Participant[] = [];
const MIN_INTENT_CHARS = 2;
const MAX_INTENT_CHARS = 2000;

class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), cache: "no-store", credentials: "include", signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error ?? `Request failed (${response.status}). Please try again.`, response.status);
  if (data === null) throw new Error("The server returned an unreadable response. Please try again.");
  return data as T;
}
function person(id: string, participants: Participant[]) { return participants.find((entry) => entry.id === id) ?? { id, name: "Former participant", initials: "?", color: "#8a8d83", isAnonymous: false }; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase() || "?"; }
function shortTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function shortDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric" }); }
function Avatar({ participant, small = false }: { participant: Pick<Participant, "name" | "initials" | "color">; small?: boolean }) { return <span title={participant.name} className={`avatar ${small ? "small" : ""}`} style={{ "--avatar-color": participant.color } as React.CSSProperties}>{participant.initials}</span>; }
function ConvergeMark({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 6v5c0 6 5 10 13 10h5M7 26v-5c0-6 5-10 13-10h5" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/><path d="m21 7 4 4-4 4m0 2 4 4-4 4" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

export default function Workspace() {
  const [user, setUser] = useState<IdentityUser | null>(null);
  const [ready, setReady] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityChecking, setIdentityChecking] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [health, setHealth] = useState<{ database: { connected: boolean }; engine: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [tab, setTab] = useState<InspectorTab>("activity");
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
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentIdRef = useRef<string | null>(null);
  const identityIdRef = useRef<string | null>(null);
  const identityRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const atBottomRef = useRef(true);
  const refreshRef = useRef<() => void>(() => {});
  const newSessionRef = useRef<() => void>(() => {});
  const pendingSubmission = useRef<{ sessionId: string; text: string; requestId: string } | null>(null);

  const applyIdentity = useCallback((next: IdentityUser | null) => {
    identityRequestRef.current++;
    if (identityIdRef.current !== (next?.id ?? null)) {
      setSessions([]); setSnapshot(null); setDraft(""); setShareLink(null);
      setShareOpen(false); setCodexOpen(false); setError(null); setConnectionError(null);
      pendingSubmission.current = null;
    }
    identityIdRef.current = next?.id ?? null; setUser(next); setIdentityChecking(false);
  }, []);
  const refreshIdentity = useCallback(async () => {
    const request = ++identityRequestRef.current;
    setIdentityChecking(true);
    try {
      const result = await api<{ user: IdentityUser | null }>("/api/identity");
      if (identityRequestRef.current === request) { applyIdentity(result.user); setIdentityError(null); }
      return result.user;
    } finally { if (identityRequestRef.current === request) setIdentityChecking(false); }
  }, [applyIdentity]);
  const loadSessions = useCallback(async () => {
    const identityId = identityIdRef.current;
    if (!identityId) return;
    const request = ++listRequestRef.current;
    const current = () => identityIdRef.current === identityId && listRequestRef.current === request;
    try { const result = await api<{ sessions: Session[] }>("/api/sessions"); if (current()) setSessions(result.sessions); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Could not load sessions."); }
    finally { if (current()) setListLoading(false); }
  }, []);

  useEffect(() => {
    let disposed = false;
    const readLocation = () => { const query = new URLSearchParams(window.location.search); const token = query.get("join") || query.get("invite"); const id = query.get("session"); setInvite(token); currentIdRef.current = id; setSessionId(id); };
    readLocation();
    setDesktop(Boolean((window as DesktopWindow).convergeDesktop?.isDesktop));
    void refreshIdentity().catch((cause) => { if (!disposed) setIdentityError(cause instanceof Error ? cause.message : "Could not connect. Try again."); }).finally(() => { if (!disposed) setReady(true); });
    void api<{ database: { connected: boolean }; engine: string }>("/api/health").then((result) => { if (!disposed) setHealth(result); }).catch(() => {});
    window.addEventListener("popstate", readLocation);
    return () => { disposed = true; window.removeEventListener("popstate", readLocation); };
  }, [refreshIdentity]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void refreshIdentity().catch((cause) => setIdentityError(cause instanceof Error ? cause.message : "Could not refresh your account.")); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [refreshIdentity]);

  useEffect(() => { if (user) { setListLoading(true); void loadSessions(); } else { setSessions([]); setSnapshot(null); } }, [user?.id, loadSessions]);
  useEffect(() => {
    if (!ready || invite) return;
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set("session", sessionId); else url.searchParams.delete("session");
    url.searchParams.delete("person"); url.searchParams.delete("join"); url.searchParams.delete("invite");
    window.history.replaceState({}, "", url);
  }, [sessionId, invite, ready]);

  useEffect(() => {
    currentIdRef.current = sessionId; setShareLink(null); setShareOpen(false); setCodexOpen(false);
    if (!sessionId || !user || invite) { setSnapshot(null); setLoading(false); setConnectionError(null); return; }
    const controller = new AbortController(); let disposed = false; let fetching = false;
    setLoading(true); setSnapshot(null); atBottomRef.current = true;
    const refresh = async () => {
      if (fetching || disposed) return;
      fetching = true;
      try {
        const data = await api<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}`, undefined, controller.signal);
        if (disposed) return;
        if (data.currentUserId !== identityIdRef.current) {
          // The shared cookie can change in another tab. Hide the old account immediately.
          applyIdentity(null); setReady(false);
          try { await refreshIdentity(); }
          catch (cause) { setIdentityError(cause instanceof Error ? cause.message : "Could not refresh your account."); }
          finally { setReady(true); }
          return;
        }
        setSnapshot(data); setConnectionError(null);
        setSessions((items) => [data.session, ...items.filter((entry) => entry.id !== data.session.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      } catch (cause) { if (!disposed) { setConnectionError(cause instanceof Error ? cause.message : "Connection interrupted."); if (cause instanceof ApiError && cause.status === 401) applyIdentity(null); } }
      finally { fetching = false; if (!disposed) setLoading(false); }
    };
    refreshRef.current = () => { void refresh(); }; void refresh();
    const stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`, { withCredentials: true });
    stream.addEventListener("change", refreshRef.current);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
    return () => { disposed = true; controller.abort(); stream.close(); window.clearInterval(timer); refreshRef.current = () => {}; };
  }, [sessionId, user?.id, invite, applyIdentity, refreshIdentity]);

  useEffect(() => {
    if (!sessionId || !user || invite || !snapshot) return;
    const ping = () => { void api(`/api/sessions/${encodeURIComponent(sessionId)}/presence`, {}).catch(() => {}); };
    ping(); const timer = window.setInterval(ping, 20000); return () => window.clearInterval(timer);
  }, [sessionId, user?.id, invite, Boolean(snapshot)]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShareOpen(false); setSidebarOpen(false); setInspectorOpen(false); setAuthOpen(false); setCodexOpen(false); }
      if (!(event.metaKey || event.ctrlKey) || !user) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((open) => !open); setSidebarOpen(true); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); newSessionRef.current(); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [user]);

  const activity = useMemo<ActivityItem[]>(() => {
    if (!snapshot) return [];
    const ids = new Set(snapshot.intents.map((intent) => intent.id));
    const events = snapshot.events.filter((event) => !(["intent", "routing", "merge", "conflict"].includes(event.kind) && event.intentIds.some((id) => ids.has(id))));
    return [...snapshot.intents.map((value): ActivityItem => ({ type: "intent", value })), ...events.map((value): ActivityItem => ({ type: "event", value }))].sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt) || (a.type !== b.type ? a.type === "intent" ? -1 : 1 : a.type === "event" && b.type === "event" ? a.value.sequence - b.value.sequence : a.value.id.localeCompare(b.value.id)));
  }, [snapshot]);
  useEffect(() => { if (atBottomRef.current) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }); else if (activity.length) setShowJump(true); }, [activity.length, snapshot?.session.revision]);

  const selectSession = (id: string) => { currentIdRef.current = id; setSessionId(id); setError(null); setSidebarOpen(false); setShareOpen(false); setDraft(""); };
  const createSession = async () => { const identityId = identityIdRef.current; const data = await api<{ session: Session }>("/api/sessions", { name: sessionName.trim() || "Untitled session" }); if (identityIdRef.current !== identityId) throw new Error("Your account changed. Select a session and try again."); setSessions((items) => [data.session, ...items]); selectSession(data.session.id); setSessionName(""); return data.session.id; };
  const newSession = async () => { if (busy || identityChecking || !user) return; setBusy("create"); setError(null); try { await createSession(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a session."); } finally { setBusy(null); } };
  newSessionRef.current = () => { void newSession(); };
  const submit = async () => {
    const text = draft.trim(); if (!text || busy || identityChecking || !user) return;
    if (text.length < MIN_INTENT_CHARS || text.length > MAX_INTENT_CHARS) { setError(`Requests must be ${MIN_INTENT_CHARS}–${MAX_INTENT_CHARS.toLocaleString()} characters. Your draft is unchanged.`); return; }
    const identityId = identityIdRef.current;
    setBusy("send"); setError(null);
    try {
      const id = sessionId ?? await createSession(); const existing = pendingSubmission.current;
      const clientRequestId = existing?.sessionId === id && existing.text === text ? existing.requestId : crypto.randomUUID();
      pendingSubmission.current = { sessionId: id, text, requestId: clientRequestId };
      await api(`/api/sessions/${encodeURIComponent(id)}/intents`, { text, clientRequestId });
      if (identityIdRef.current !== identityId) return;
      pendingSubmission.current = null; setDraft(""); if (currentIdRef.current === id) refreshRef.current(); atBottomRef.current = true;
    } catch (cause) { if (identityIdRef.current === identityId) { setDraft(text); setError(cause instanceof Error ? cause.message : "Your request could not be sent."); } }
    finally { setBusy(null); textareaRef.current?.focus(); }
  };
  const control = async (action: "pause" | "resume" | "retry") => { if (!sessionId || busy) return; setBusy(action); setError(null); try { await api(`/api/sessions/${encodeURIComponent(sessionId)}/control`, { action }); refreshRef.current(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the session."); } finally { setBusy(null); } };
  const resolve = async (intentId: string, choice: "keep-existing" | "replace-existing") => { if (!sessionId || busy) return; setBusy(intentId); setError(null); try { await api(`/api/sessions/${encodeURIComponent(sessionId)}/resolve`, { intentId, choice }); refreshRef.current(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not resolve the conflict."); } finally { setBusy(null); } };
  const prepareShare = async () => {
    if (!sessionId || shareBusy) return; setShareOpen(true); if (shareLink) return;
    setShareBusy(true); setError(null);
    try { const result = await api<{ url: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/share`, {}); if (currentIdRef.current === sessionId) setShareLink(result.url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create an invite link."); }
    finally { setShareBusy(false); }
  };
  const copyLink = async () => { if (!shareLink) return; try { await navigator.clipboard.writeText(shareLink); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { setError("Clipboard access is unavailable. Select and copy the invite link below Share session."); } };
  const openCollaborator = async () => { if (!shareLink) return; try { await (window as DesktopWindow).convergeDesktop?.openCollaboratorWindow({ url: shareLink }); setShareOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open the invite window."); } };
  const signOut = async () => { setBusy("signout"); try { const result = await authClient.signOut(); if (result.error) throw new Error(result.error.message || "Sign out failed."); applyIdentity(null); setSessionId(null); setSnapshot(null); setAuthOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); } finally { setBusy(null); } };
  const joinSession = async () => { if (!invite || busy) return; setBusy("join"); setError(null); try { const result = await api<{ sessionId: string }>("/api/join", { token: invite }); setInvite(null); selectSession(result.sessionId); void loadSessions(); } catch (cause) { setError(cause instanceof Error ? cause.message : "This invite could not be used."); } finally { setBusy(null); } };
  const authComplete = async () => { const next = await refreshIdentity(); if (!next) throw new Error("Sign in did not create a session. Please try again."); setAuthOpen(false); };
  const toggleInspector = () => { if (window.matchMedia("(max-width: 1000px)").matches) setInspectorOpen(!inspectorOpen); else setInspectorCollapsed(!inspectorCollapsed); };

  if (!ready) return <div className="auth-page"><div className="auth-brand"><ConvergeMark/><span>converge</span></div><div className="auth-loading"><Loader2 size={22} className="spin"/><span>Connecting…</span></div></div>;
  if (!user) return <AuthPanel invite={Boolean(invite)} onComplete={authComplete} externalError={identityError} onRetry={() => { void refreshIdentity().catch((cause) => setIdentityError(cause instanceof Error ? cause.message : "Could not connect.")); }}/>;
  if (invite) return <div className="auth-page"><div className="auth-brand"><ConvergeMark/><span>converge</span></div><section className="auth-card"><span className="auth-symbol"><Users size={24}/></span><h1>Join coding session</h1><p>You’re joining as <strong>{user.name}</strong>. You’ll be able to add requests and see this session’s activity and changes.</p>{error && <div className="auth-error" role="alert">{error}</div>}<button className="primary-button" disabled={!!busy} onClick={() => void joinSession()}>{busy === "join" ? <Loader2 size={16} className="spin"/> : <ArrowRight size={16}/>}Join session</button><button className="auth-back" onClick={() => { setInvite(null); setSessionId(null); setError(null); }}>Back to my sessions</button><p className="auth-note">{user.isAnonymous ? "Guest session" : user.email}<button onClick={() => void signOut()} disabled={!!busy}>Use another account</button></p></section></div>;

  const session = snapshot?.session;
  const participants = snapshot?.participants ?? EMPTY_PARTICIPANTS;
  const self = participants.find((entry) => entry.id === user.id) ?? { id: user.id, name: user.name, initials: initials(user.name), color: "#66775b", isAnonymous: user.isAnonymous };
  const onlinePeople = [...new Set(snapshot?.presence.filter((entry) => Date.now() - new Date(entry.seenAt).getTime() < 45000).map((entry) => entry.personId) ?? [])];
  const isWorking = session?.status === "running" || session?.status === "planning";
  const filteredSessions = sessions.filter((entry) => `${entry.name} ${entry.goal}`.toLowerCase().includes(search.toLowerCase()));
  const storageConnected = (snapshot?.storage.connected ?? health?.database.connected) === true && !connectionError;

  return <div className={`converge-app ${desktop ? "desktop-shell" : ""}`}>
    <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`} aria-label="Workspace navigation">
      <div className="sidebar-brand"><div className="brand-icon"><ConvergeMark size={23}/></div><span>converge</span><button className="icon-button sidebar-dismiss" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={16}/></button></div>
      <div className="identity-card"><Avatar participant={self}/><div><strong>{user.name}</strong><span>{user.isAnonymous ? "Guest" : user.email || "Member"}</span></div></div>
      <div className="sidebar-actions"><button onClick={() => void newSession()} disabled={!!busy}><Plus size={17}/><span>New session</span><span className="key-hint">⌘ N</span></button><button onClick={() => setSearchOpen(!searchOpen)}><Search size={16}/><span>Find a session</span></button></div>
      {searchOpen && <label className="session-search"><Search size={13}/><input autoFocus aria-label="Search sessions" placeholder="Search sessions…" value={search} onChange={(event) => setSearch(event.target.value)}/></label>}
      <div className="sidebar-section-heading"><span>YOUR SESSIONS</span><button className="icon-button" aria-label="Refresh sessions" onClick={() => void loadSessions()}><RefreshCw size={12}/></button></div>
      <nav className="session-list" aria-label="Sessions">{listLoading ? <div className="sidebar-loading"><Loader2 className="spin" size={14}/>Loading sessions</div> : filteredSessions.length ? filteredSessions.map((entry) => <button key={entry.id} className={`session-link ${entry.id === sessionId ? "selected" : ""}`} onClick={() => selectSession(entry.id)}><MessageSquare size={15}/><span>{entry.name || "Untitled session"}<small>{shortDate(entry.updatedAt)}</small></span>{["planning", "running"].includes(entry.status) ? <span className="tiny-dot working"/> : ["blocked", "error"].includes(entry.status) ? <span className="tiny-dot warning"/> : null}</button>) : <p className="sidebar-empty">{search ? "No matching sessions." : "No sessions yet. Create one to start."}</p>}</nav>
      {session && <div className="sidebar-team"><div className="sidebar-section-heading"><span>PARTICIPANTS</span><span className="team-count">{participants.length}</span></div>{participants.map((entry) => <div key={entry.id} className="team-person"><Avatar participant={entry} small/><span>{entry.name}{entry.id === user.id && <small>You{entry.isAnonymous ? " · Guest" : ""}</small>}</span>{onlinePeople.includes(entry.id) && <span className="tiny-dot online" title="Present in this session"/>}</div>)}</div>}
      <div className="sidebar-bottom">{user.isAnonymous && <div className="guest-notice"><p>Keep access across devices.</p><button onClick={() => setAuthOpen(true)}>Create an account<ArrowUpRight size={12}/></button></div>}<button className="account-signout" disabled={!!busy} onClick={() => void signOut()}><LogOut size={13}/>{user.isAnonymous ? "Leave guest account" : "Sign out"}</button></div>
    </aside>
    {sidebarOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}/>}
    <main className="main-workspace">
      <header className="session-header"><div className="session-heading"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Layers3 size={18}/></button><span className="breadcrumb">Sessions</span><ChevronRight size={12}/><h1>{session?.name || (sessionId ? "Loading session" : "New session")}</h1>{session && <span className={`session-state state-${session.status}`}><span className="tiny-dot"/>{session.status === "complete" ? "Verified" : session.status === "running" ? "Working" : session.status === "idle" ? "Ready" : session.status}</span>}</div><div className="header-actions"><button className="code-connect-button" disabled={!snapshot} onClick={() => setCodexOpen(true)}><SquareTerminal size={14}/><span>Connect Codex</span></button>{onlinePeople.length > 0 && <div className="presence-avatars" aria-label={`${onlinePeople.length} participants online`}>{onlinePeople.map((id) => <Avatar key={id} participant={person(id, participants)} small/>)}</div>}<div className="share-wrap"><button className="share-button" disabled={!snapshot} onClick={() => { if (shareOpen) setShareOpen(false); else void prepareShare(); }}><Users size={14}/><span>Share session</span></button>{shareOpen && <div className="share-popover"><strong>Invite a collaborator</strong><p>Anyone with this link can join and contribute to this session.</p>{shareBusy ? <span className="share-loading"><Loader2 size={14} className="spin"/>Creating invite…</span> : shareLink ? <><input className="invite-link" readOnly aria-label="Session invite link" value={shareLink} onFocus={(event) => event.target.select()}/><button onClick={() => void copyLink()}>{copied ? <Check size={14}/> : <Link2 size={14}/>} {copied ? "Link copied" : "Copy invite link"}</button>{desktop && <button onClick={() => void openCollaborator()}><ArrowUpRight size={14}/>Open invite window</button>}</> : <button onClick={() => void prepareShare()}><RefreshCw size={14}/>Retry creating link</button>}</div>}</div><button className={`icon-button inspector-toggle ${inspectorOpen ? "selected" : ""}`} aria-label="Toggle session details" onClick={toggleInspector}><PanelRight size={18}/></button></div></header>
      {(error || connectionError || session?.error) && <div className="error-banner" role="alert"><TriangleAlert size={15}/><span>{error || connectionError || session?.error}</span>{error ? <button aria-label="Dismiss error" onClick={() => setError(null)}><X size={14}/></button> : <button onClick={() => refreshRef.current()}><RefreshCw size={13}/>Retry</button>}</div>}
      <div className="workspace-columns"><section className="conversation-column" aria-label="Session conversation">
        <div className="conversation-context"><span className="live-indicator"><span className={`tiny-dot ${snapshot?.worker.online ? "online" : ""}`}/>{snapshot ? snapshot.worker.online ? "Worker online" : "Worker offline" : "No session selected"}</span>{session && <button className="quiet-button" disabled={!!busy || !["planning", "running", "paused", "error"].includes(session.status)} onClick={() => void control(session.status === "paused" ? "resume" : session.status === "error" ? "retry" : "pause")}>{session.status === "paused" ? <Play size={12}/> : session.status === "error" ? <RefreshCw size={12}/> : <Pause size={12}/>} {session.status === "paused" ? "Resume" : session.status === "error" ? "Retry" : session.pauseRequested ? "Pausing…" : "Pause"}</button>}</div>
        {snapshot && !snapshot.worker.online && <div className="worker-notice"><SquareTerminal size={15}/><span>Requests are saved. Open Converge on the host Mac to run queued work.</span></div>}
        <div className="transcript" ref={transcriptRef} onScroll={(event) => { const element = event.currentTarget; atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; if (atBottomRef.current) setShowJump(false); }}>
          {loading && !snapshot ? <div className="loading-session"><Loader2 size={20} className="spin"/><p>Opening session…</p></div> : connectionError && !snapshot ? <div className="session-empty"><TriangleAlert size={26}/><h2>Session unavailable</h2><p>Check the invite link or choose another session.</p><button className="secondary-button" onClick={() => { setSessionId(null); setConnectionError(null); }}>Back to sessions</button></div> : activity.length === 0 ? <div className="session-empty"><span className="empty-session-icon"><SquareTerminal size={25}/></span><h2>{session ? "What should the agent change?" : "Start a coding session"}</h2><p>{session ? "Describe the task below. Invite collaborators to add their requests to this session." : "Create a session, describe the task, and invite people to work with you."}</p>{!session && <form className="new-session-form" onSubmit={(event) => { event.preventDefault(); void newSession(); }}><label htmlFor="session-name">Session name <span>optional</span></label><input id="session-name" value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="e.g. Product catalog" maxLength={80}/><button className="primary-button" disabled={!!busy}>{busy === "create" ? <Loader2 size={15} className="spin"/> : <Plus size={15}/>}Create session</button></form>}{session && <div className="task-examples"><span>Example requests</span>{["Connect Stripe and display the product catalog", "Add NEW to the 3 most recently added Stripe products"].map((text) => <button key={text} onClick={() => { setDraft(text); textareaRef.current?.focus(); }}>{text}<ArrowUpRight size={13}/></button>)}<small>The current coding workspace uses a Stripe-compatible test fixture.</small></div>}</div> : <div className="activity-list"><div className="thread-start"><span/>{session ? shortDate(session.createdAt) : "Today"}<span/></div>{activity.map((item) => item.type === "intent" ? <IntentCard key={`intent-${item.value.id}`} intent={item.value} participants={participants} disabled={!!busy} onResolve={resolve}/> : <AgentEvent key={`event-${item.value.id}`} event={item.value}/>)}{isWorking && <div className="working-indicator"><span className="agent-avatar"><ConvergeMark size={15}/></span><span className="thinking-dots"><i/><i/><i/></span><span>{!snapshot?.worker.online ? "Waiting for worker" : session?.status === "planning" ? "Routing requests" : "Agent working"}</span></div>}</div>}
        </div>
        {showJump && <button className="jump-button" onClick={() => { atBottomRef.current = true; setShowJump(false); transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={13}/>Latest activity</button>}
        <div className="composer-area"><form className={`composer ${busy === "send" ? "sending" : ""}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}><textarea ref={textareaRef} disabled={busy === "send" || busy === "create" || Boolean(sessionId && !snapshot)} aria-label="Request a change" placeholder="Describe a task or request a change…" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={MAX_INTENT_CHARS} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/><div className="composer-toolbar"><span className="posting-identity"><Avatar participant={self} small/>{user.name}{user.isAnonymous && <small>Guest</small>}</span><div className="composer-right">{draft.length > 1600 && <small>{draft.length}/{MAX_INTENT_CHARS}</small>}<button className="send-button" type="submit" disabled={draft.trim().length < MIN_INTENT_CHARS || draft.trim().length > MAX_INTENT_CHARS || !!busy || identityChecking || Boolean(sessionId && !snapshot)} aria-label="Send request">{busy === "send" || busy === "create" ? <Loader2 size={17} className="spin"/> : <ArrowUp size={18}/>}</button></div></div></form><div className="composer-footer"><span><Command size={10}/>Enter to send<span className="footer-dot">·</span>Shift + Enter for a new line</span><span>{user.isAnonymous ? "Guest session" : "Signed in"}</span></div></div>
      </section>
      <aside className={`inspector ${tab === "activity" ? "graph-inspector" : ""} ${inspectorOpen ? "inspector-open" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""}`} aria-label="Session details"><div className="inspector-tabs" role="tablist" aria-label="Session detail panels">{(["activity", "plan", "changes", "memory"] as const).map((value) => <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`panel-${value}`} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value === "activity" ? "Activity" : value === "plan" ? "Plan" : value === "changes" ? "Changes" : "Memory"}{value === "changes" && session?.artifact?.files.length ? <span>{session.artifact.files.length}</span> : null}</button>)}<button className="icon-button close-inspector" aria-label="Close session details" onClick={() => setInspectorOpen(false)}><X size={15}/></button></div><div className={`inspector-body ${tab === "activity" ? "graph-body" : ""}`} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>{tab === "activity" ? snapshot ? <IntentGraph snapshot={snapshot}/> : <div className="inspector-empty"><span><GitBranch size={25}/></span><h2>Session activity</h2><p>Select or create a session to see requests, dependencies, and agent execution.</p></div> : tab === "plan" ? <PlanPanel session={session} intents={snapshot?.intents ?? []} participants={participants} onChanges={() => setTab("changes")}/> : tab === "changes" ? <ChangesPanel artifact={session?.artifact}/> : <MemoryPanel checkpoints={snapshot?.checkpoints ?? []} session={session}/>}</div><div className="inspector-footer"><div><span className={`tiny-dot ${storageConnected ? "online" : ""}`}/>{snapshot || health ? storageConnected ? "Atlas connected" : "Atlas unavailable" : "Connecting to Atlas…"}</div><span>{session ? `REV ${session.revision}` : ""}</span></div></aside></div>
    </main>
    {codexOpen && sessionId && <CodexConnect sessionId={sessionId} desktop={desktop} onClose={() => setCodexOpen(false)}/>}
    {authOpen && <div className="auth-modal" role="dialog" aria-modal="true" aria-label="Save your guest account"><AuthPanel upgrade initialName={user.name} onComplete={authComplete} onClose={() => setAuthOpen(false)}/></div>}
  </div>;
}

function AuthPanel({ invite = false, upgrade = false, initialName = "", onComplete, onClose, externalError, onRetry }: { invite?: boolean; upgrade?: boolean; initialName?: string; onComplete: () => Promise<void>; onClose?: () => void; externalError?: string | null; onRetry?: () => void }) {
  const [mode, setMode] = useState<"guest" | "signin" | "signup">(upgrade ? "signup" : "guest");
  const [name, setName] = useState(initialName); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault(); if (working) return; setWorking(true); setError(null);
    try {
      if (mode === "guest") await api("/api/guest", { name: name.trim() });
      else { const result = mode === "signup" ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password }) : await authClient.signIn.email({ email: email.trim(), password }); if (result.error) throw new Error(result.error.message || "Authentication failed. Please try again."); }
      await onComplete();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not continue. Please try again."); }
    finally { setWorking(false); }
  };
  return <div className={upgrade ? "auth-upgrade" : "auth-page"}>{!upgrade && <div className="auth-brand"><ConvergeMark/><span>converge</span></div>}<section className="auth-card">{onClose && <button className="icon-button auth-close" aria-label="Close account form" onClick={onClose}><X size={18}/></button>}<span className="auth-symbol"><SquareTerminal size={25}/></span><h1>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create an account" : invite ? "Join a coding session" : "Start a coding session"}</h1><p>{mode === "guest" ? "Choose a name so collaborators know who’s contributing. No account required." : upgrade ? "Keep your current sessions and access them from another device." : "Use your account to access your coding sessions."}</p><form onSubmit={(event) => void submitAuth(event)}>{mode !== "signin" && <label>Your name<input name="name" autoComplete="name" autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name"/></label>}{mode !== "guest" && <><label>Email<input name="email" type="email" autoComplete="email" autoFocus={mode === "signin"} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label><label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 10 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 10 characters" : "Your password"}/></label></>}{(error || externalError) && <div className="auth-error" role="alert">{error || externalError}{externalError && onRetry && <button type="button" onClick={onRetry}>Retry connection</button>}</div>}<button className="primary-button" disabled={working || (mode !== "signin" && !name.trim())}>{working ? <Loader2 size={16} className="spin"/> : <ArrowRight size={16}/>} {mode === "guest" ? "Continue as guest" : mode === "signup" ? "Create account" : "Sign in"}</button></form><div className="auth-options">{mode === "guest" ? <><span>Already have an account?</span><button onClick={() => { setMode("signin"); setError(null); }}>Sign in</button><span className="auth-divider">·</span><button onClick={() => { setMode("signup"); setError(null); }}>Create account</button></> : <><span>{mode === "signin" ? "Need an account?" : "Already have an account?"}</span><button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>{mode === "signin" ? "Create account" : "Sign in"}</button></>}</div>{mode !== "guest" && !upgrade && <button className="auth-back" onClick={() => { setMode("guest"); setError(null); }}>Continue as guest instead</button>}{mode === "guest" && <p className="auth-note">Guest access stays in this browser. You can create an account later without losing your sessions.</p>}</section></div>;
}

function IntentCard({ intent, participants, disabled, onResolve }: { intent: Intent; participants: Participant[]; disabled: boolean; onResolve: (id: string, choice: "keep-existing" | "replace-existing") => Promise<void> }) {
  const author = person(intent.authorId, participants);
  const conflicting = intent.status === "blocked" && intent.decision?.relation === "conflict";
  return <article className={`intent-card ${conflicting ? "has-conflict" : ""}`}><div className="intent-author"><Avatar participant={author} small/><strong>{author.name}</strong><span>{author.isAnonymous ? "Guest" : "Member"}</span><time dateTime={intent.createdAt}>{shortTime(intent.createdAt)}</time>{intent.status === "fulfilled" && <span className="intent-fulfilled"><CheckCheck size={12}/>Fulfilled</span>}</div><div className="intent-bubble"><p>{intent.text}</p></div>{intent.decision ? <div className={`intent-routing relation-${intent.decision.relation}`}><div className="routing-label">{conflicting ? <TriangleAlert size={12}/> : intent.decision.relation === "duplicate" ? <CheckCheck size={12}/> : <GitMerge size={12}/>}<span>{RELATIONS[intent.decision.relation]}</span>{intent.decision.parentIntentIds.length > 0 && <span className="routing-parent">{intent.decision.parentIntentIds.length} linked {intent.decision.parentIntentIds.length === 1 ? "intent" : "intents"}</span>}</div><p>{intent.decision.summary}</p>{conflicting ? <div className="conflict-options"><p>{intent.decision.reason}</p><div><button disabled={disabled} onClick={() => void onResolve(intent.id, "keep-existing")}>Keep earlier request</button><button disabled={disabled} onClick={() => void onResolve(intent.id, "replace-existing")}>Replace earlier request<ArrowRight size={12}/></button></div></div> : <details className="routing-reason"><summary>Routing details<ChevronDown size={10}/></summary><p>{intent.decision.reason}</p></details>}</div> : <div className="intent-pending"><span className="tiny-dot working"/>{intent.status === "queued" ? "Waiting for routing…" : intent.status}</div>}{intent.resolution && <div className="resolved-note"><Check size={11}/>{intent.resolution === "keep-existing" ? "Earlier request kept" : "Replacement accepted"}</div>}</article>;
}

function AgentEvent({ event }: { event: TrajectoryEvent }) {
  const Icon = event.kind === "tool" ? SquareTerminal : event.kind === "verification" ? ShieldCheck : event.kind === "checkpoint" ? Layers3 : event.kind === "conflict" ? TriangleAlert : event.kind === "merge" ? GitMerge : ConvergeMark;
  if (event.kind === "agent") return <article className="agent-message"><div className="agent-message-heading"><span className="agent-avatar"><ConvergeMark size={14}/></span><strong>Converge</strong><span>{event.actor !== "agent" && event.actor !== "codex" ? event.actor : "Agent"}</span><time>{shortTime(event.createdAt)}</time></div>{event.title && <h3>{event.title}</h3>}{event.detail && event.detail !== event.title && <p>{event.detail}</p>}</article>;
  return <details className={`trajectory-event event-${event.kind}`}><summary><span className="trajectory-icon"><Icon size={14}/></span><span className="trajectory-title">{event.title}</span>{event.kind === "checkpoint" ? <span className="event-mini-label">Memory</span> : null}<time>{shortTime(event.createdAt)}</time><ChevronRight size={11}/></summary>{event.detail && <pre className="event-detail">{event.detail}</pre>}{event.intentIds.length > 0 && <span className="event-linked">{event.intentIds.length} linked {event.intentIds.length === 1 ? "intent" : "intents"}</span>}</details>;
}

function PlanPanel({ session, intents, participants, onChanges }: { session?: Session; intents: Intent[]; participants: Participant[]; onChanges: () => void }) {
  const steps = session?.plan.steps ?? [];
  const done = steps.filter((step) => step.status === "done").length;
  return <><div className="panel-eyebrow"><GitMerge size={13}/>SHARED PLAN</div><h2 className="panel-title">Implementation plan</h2><p className="panel-intro">{session?.plan.summary || "Accepted requests and their dependencies appear here."}</p>{steps.length ? <div className="plan-progress"><div><span>Implementation</span><span>{done} / {steps.length}</span></div><div className="progress-track"><i style={{ width: `${done / steps.length * 100}%` }}/></div></div> : null}<div className="plan-steps">{steps.map((step, index) => <div className={`plan-step step-${step.status}`} key={step.id}><span className="step-status">{step.status === "done" ? <Check size={12}/> : step.status === "running" ? <Loader2 size={13} className="spin"/> : step.status === "blocked" ? <TriangleAlert size={12}/> : <span>{index + 1}</span>}</span><div><h3>{step.title}</h3><div className="step-attribution">{[...new Set(step.intentIds.map((id) => intents.find((intent) => intent.id === id)?.authorId).filter((id): id is string => !!id))].map((id) => <span key={id}><i style={{ background: person(id, participants).color }}/>{person(id, participants).name}</span>)}{step.dependsOn.length > 0 && <small><CornerDownRight size={10}/>{step.dependsOn.length} prerequisite{step.dependsOn.length > 1 ? "s" : ""}</small>}</div></div></div>)}</div>{steps.length === 0 && <div className="plan-empty-visual"><div className="plan-placeholder-line"><span/><i/></div><div className="plan-placeholder-line"><span/><i/></div><div className="plan-placeholder-line"><span/><i/></div><p>Send a request to create the plan.</p></div>}{session?.plan.constraints.length ? <section className="panel-section"><h3><Layers3 size={13}/>Shared constraints</h3>{session.plan.constraints.map((constraint, index) => <div className="constraint" key={`${constraint.intentId}-${index}`}><Avatar participant={person(constraint.authorId, participants)} small/><p>{constraint.text}</p></div>)}</section> : null}{session?.artifact ? <section className="panel-section"><div className="panel-section-heading"><h3><Box size={13}/>Verified preview</h3><button className="text-link" onClick={onChanges}>View changes<ArrowUpRight size={11}/></button></div><ProductPreview artifact={session.artifact}/></section> : null}{session && <div className="session-facts"><span><GitMerge size={12}/>{session.metrics.mergedIntents} intents merged</span><span><SquareTerminal size={12}/>{session.metrics.turns} agent turns</span></div>}</>;
}

function ProductPreview({ artifact }: { artifact: Artifact }) {
  return <div className="product-preview"><div className="preview-browser"><span className="preview-dots"><i/><i/><i/></span><span><Box size={9}/>catalog / preview</span><ArrowUpRight size={11}/></div><div className="catalog-heading"><span>STRIPE-COMPATIBLE FIXTURE</span><h4>Product catalog</h4></div>{artifact.products.length ? <div className="product-grid">{artifact.products.slice(0, 6).map((product, index) => <div className="product" key={product.id}><div className={`product-object object-${index % 6}`}>{product.badge && <span className="product-badge">{product.badge}</span>}<span className="product-shape"><Box size={30} strokeWidth={1}/></span></div><h5>{product.name}</h5><span>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(product.price)}</span></div>)}</div> : <div className="catalog-empty"><Box size={22}/><p>No products in the current artifact.</p></div>}<div className="preview-disclaimer"><span className={`tiny-dot ${artifact.stripeConnected ? "online" : ""}`}/>{artifact.stripeConnected ? "Stripe-compatible fixture" : "Catalog fixture preview"}<span>Not a live store</span></div></div>;
}

function ChangesPanel({ artifact }: { artifact?: Artifact }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [view, setView] = useState<"diff" | "preview">("diff");
  const activeFile = selectedFile && artifact?.files.some((file) => file.path === selectedFile) ? selectedFile : null;
  const diff = useMemo(() => { if (!artifact?.diff || !activeFile) return artifact?.diff ?? ""; const chunks = artifact.diff.split(/(?=^diff --git )/m); return chunks.find((chunk) => chunk.split("\n")[0]?.includes(activeFile)) ?? artifact.diff; }, [artifact?.diff, activeFile]);
  if (!artifact) return <div className="inspector-empty"><span><Files size={25} strokeWidth={1.3}/></span><h2>No verified changes yet</h2><p>Source diffs and protected checks appear after the worker verifies a revision.</p></div>;
  const passed = artifact.checks.filter((check) => check.passed).length;
  return <><div className="changes-heading"><div className="panel-eyebrow"><Files size={13}/>WORKING CHANGES</div><span>r{artifact.verifiedRevision}</span></div><div className="change-summary"><h2>{artifact.files.length} changed {artifact.files.length === 1 ? "file" : "files"}</h2><span className="diff-added">+{artifact.files.reduce((sum, file) => sum + file.additions, 0)}</span><span className="diff-removed">−{artifact.files.reduce((sum, file) => sum + file.deletions, 0)}</span></div><div className="file-list">{artifact.files.map((file) => <button key={file.path} className={activeFile === file.path ? "active" : ""} onClick={() => { setSelectedFile(activeFile === file.path ? null : file.path); setView("diff"); }}><FileCode2 size={13}/><span>{file.path}</span><small className="diff-added">+{file.additions}</small>{file.deletions > 0 && <small className="diff-removed">−{file.deletions}</small>}</button>)}</div><div className="artifact-view-tabs"><button onClick={() => setView("diff")} className={view === "diff" ? "active" : ""}><Code2 size={12}/>Diff</button><button onClick={() => setView("preview")} className={view === "preview" ? "active" : ""}><Box size={12}/>Preview</button></div>{view === "preview" ? <ProductPreview artifact={artifact}/> : diff ? <div className="diff-view" aria-label={activeFile ? `Diff for ${activeFile}` : "Code diff"}><div className="diff-file-label">{activeFile || "All changes"}</div><pre>{diff.split("\n").map((line, index) => <div key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""}><span className="line-number">{index + 1}</span><code>{line || " "}</code></div>)}</pre></div> : <p className="panel-muted">No textual diff was returned for this revision.</p>}<section className="panel-section checks-section"><div className="panel-section-heading"><h3><ShieldCheck size={13}/>Verification</h3><span>{passed}/{artifact.checks.length} passed</span></div>{artifact.checks.length ? artifact.checks.map((check, index) => <details className={`check-row ${check.passed ? "passed" : "failed"}`} key={`${check.name}-${index}`}><summary>{check.passed ? <CircleCheck size={14}/> : <TriangleAlert size={14}/>}<span>{check.name}</span><ChevronRight size={11}/></summary><p>{check.detail}</p></details>) : <p className="panel-muted">No checks reported yet.</p>}</section><p className="artifact-timestamp">Artifact updated {shortTime(artifact.updatedAt)}</p></>;
}

function MemoryPanel({ checkpoints, session }: { checkpoints: MemoryCheckpoint[]; session?: Session }) {
  return <><div className="panel-eyebrow"><Layers3 size={13}/>DURABLE MEMORY</div><h2 className="panel-title">Session checkpoints</h2><p className="panel-intro">Checkpoints preserve active requests, decisions, and source files in Atlas.</p>{session && <div className="memory-stat-row"><div><strong>{session.metrics.contextChars.toLocaleString()}</strong><span>context characters</span></div><div><strong>{session.metrics.archivedEvents}</strong><span>archived events</span></div></div>}{checkpoints.length ? <div className="checkpoint-list">{[...checkpoints].reverse().map((checkpoint) => <article className="checkpoint" key={checkpoint.id}><div className="checkpoint-heading"><span><Layers3 size={13}/>Checkpoint</span><small>r{checkpoint.revision}</small><time>{shortTime(checkpoint.createdAt)}</time></div><p>{checkpoint.summary}</p>{checkpoint.decisions.length > 0 && <details><summary>{checkpoint.decisions.length} preserved decisions<ChevronDown size={11}/></summary><ul>{checkpoint.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul></details>}<div className="checkpoint-meta"><span>{checkpoint.intentIds.length} intents</span><span>{checkpoint.eventCount} events</span><span>{checkpoint.contextChars.toLocaleString()} chars</span></div></article>)}</div> : <div className="memory-empty"><Layers3 size={28} strokeWidth={1.2}/><h3>No checkpoints yet</h3><p>The worker saves checkpoints after verification, pause, or interruption.</p></div>}{session?.codexThreadId && <div className="thread-reference"><SquareTerminal size={12}/><span>Persistent agent thread<code>{session.codexThreadId.slice(0, 18)}…</code></span></div>}</>;
}

function CodexConnect({ sessionId, desktop, onClose }: { sessionId: string; desktop: boolean; onClose: () => void }) {
  const [connection, setConnection] = useState<{ command: string; expiresAt: string; serverUrl: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [installedName, setInstalledName] = useState<string | null>(null);
  const requestRef = useRef<{ key: string; promise: Promise<{ command: string; expiresAt: string; serverUrl: string; token: string }> } | null>(null);
  useEffect(() => {
    let disposed = false;
    setError(null); setConnection(null);
    const key = `${sessionId}:${attempt}`;
    if (requestRef.current?.key !== key) requestRef.current = { key, promise: api<{ command: string; expiresAt: string; serverUrl: string; token: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/codex/connect`, {}) };
    void requestRef.current.promise.then((result) => { if (!disposed) setConnection(result); }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not create the setup command."); });
    return () => { disposed = true; };
  }, [sessionId, attempt]);
  const copy = async () => {
    if (!connection) return;
    try { await navigator.clipboard.writeText(connection.command); setCopied(true); }
    catch { setError("Clipboard access is unavailable. Select and copy the command below."); }
  };
  const install = async () => {
    if (!connection || installing || installedName) return;
    const shell = (window as DesktopWindow).convergeDesktop;
    if (!shell?.installCodexConnection) { setError("This app version does not support direct installation. Use the setup command below."); return; }
    setInstalling(true); setError(null);
    try {
      const result = await shell.installCodexConnection({ sessionId, serverUrl: connection.serverUrl, token: connection.token });
      if (result?.installed !== true) throw new Error("Codex setup did not finish. Use the command below or try again.");
      setInstalledName(result.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not install the Codex connection. Use the setup command below."); }
    finally { setInstalling(false); }
  };
  return <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="codex-connect-title"><section className="connect-card"><button autoFocus className="icon-button auth-close" aria-label="Close Codex setup" onClick={onClose}><X size={18}/></button><span className="auth-symbol"><SquareTerminal size={25}/></span><h2 id="codex-connect-title">Connect Codex</h2><p>Use this session from the Codex app or CLI. Activity reported by Codex appears here.</p><div className="native-connect-action">{desktop && (installedName ? <div className="connect-installed" role="status"><CircleCheck size={18}/><div><strong>Added to Codex</strong><p>Start a new Codex task and ask it to use the Converge skill for this session.</p></div></div> : <button className="primary-button" disabled={!connection || installing} onClick={() => void install()}>{installing ? <Loader2 size={16} className="spin"/> : <Plus size={16}/>} {installing ? "Installing…" : "Add to Codex"}</button>)}</div><ol className="connect-steps"><li><strong>{desktop ? "Or use the setup command" : "Add this session to Codex"}</strong><span>Run the setup command in your terminal.</span>{connection ? <><textarea readOnly aria-label="Codex setup command" value={connection.command} onFocus={(event) => event.target.select()} rows={5}/><button className="secondary-button" onClick={() => void copy()}>{copied ? <Check size={14}/> : <Link2 size={14}/>} {copied ? "Command copied" : "Copy setup command"}</button></> : !error && <span className="share-loading"><Loader2 size={14} className="spin"/>Creating session connection…</span>}</li><li><strong>Start a Codex task</strong><span>Ask Codex to read the Converge session, work on its accepted requests, and report progress.</span></li></ol>{error && <div className="auth-error" role="alert">{error}{!connection && <button onClick={() => setAttempt((value) => value + 1)}>Retry</button>}</div>}<div className="connect-scope"><ShieldCheck size={15}/><p>The connection can read this session and report activity. It does not grant filesystem access or automatically import other Codex tasks.{connection && <span>Session token expires {new Date(connection.expiresAt).toLocaleDateString()}.</span>}</p></div><button className="primary-button" onClick={onClose}>Done</button></section></div>;
}
