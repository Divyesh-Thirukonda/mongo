export type PersonId = string;
export interface Identity { id: string; name: string; email?: string; isAnonymous: boolean }
export interface Participant { id: string; name: string; initials: string; color: string; isAnonymous: boolean }
export const PEOPLE = [
  { id: "alex" as const, name: "Alex Morgan", initials: "AM", color: "#6579c5", role: "Engineering" },
  { id: "sam" as const, name: "Sam Chen", initials: "SC", color: "#ad7854", role: "Product" },
  { id: "jordan" as const, name: "Jordan Lee", initials: "JL", color: "#648776", role: "Design" },
];
export type IntentRelation = "start" | "extend" | "depend" | "duplicate" | "conflict" | "parallel";
export type IntentStatus = "queued" | "accepted" | "blocked" | "fulfilled" | "superseded" | "duplicate";
export interface RoutingDecision {
  relation: IntentRelation;
  summary: string;
  reason: string;
  parentIntentIds: string[];
  acceptance: string[];
  source: "openrouter" | "rules";
}
export interface Intent {
  id: string;
  sessionId: string;
  authorId: PersonId;
  text: string;
  createdAt: string;
  revision: number;
  status: IntentStatus;
  decision?: RoutingDecision;
  resolution?: "keep-existing" | "replace-existing";
}
export interface PlanStep {
  id: string;
  title: string;
  intentIds: string[];
  dependsOn: string[];
  status: "pending" | "running" | "done" | "blocked";
}
export interface SharedPlan {
  summary: string;
  steps: PlanStep[];
  constraints: Array<{ intentId: string; text: string; authorId: PersonId }>;
  revision: number;
}
export interface CheckResult { name: string; passed: boolean; detail: string; intentIds: string[] }
export interface Product { id: string; name: string; price: number; created: number; badge?: string }
export interface Artifact {
  files: Array<{ path: string; additions: number; deletions: number }>;
  diff: string;
  checks: CheckResult[];
  products: Product[];
  stripeConnected: boolean;
  verifiedRevision: number;
  updatedAt: string;
}
export interface SessionMetrics {
  turns: number; toolCalls: number; mergedIntents: number; avoidedRuns: number;
  checksPassed: number; checksTotal: number; contextChars: number; archivedEvents: number;
  providerTokens: number; steers: number;
}
export interface Session {
  id: string;
  ownerId?: string;
  name: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  processedRevision: number;
  status: "idle" | "planning" | "running" | "review" | "blocked" | "complete" | "error" | "paused";
  plan: SharedPlan;
  metrics: SessionMetrics;
  codexThreadId?: string;
  activeTurnId?: string;
  lastCheckpointAt?: string;
  sourceCheckpointId?: string;
  historyRequest?: { id: string; checkpointId: string; recoveryCheckpointId?: string; authorId: string; createdAt: string; revision: number; text?: string };
  artifact?: Artifact;
  error?: string;
  pauseRequested?: boolean;
  leaseOwner?: string;
  leaseUntil?: string;
}
export interface TrajectoryEvent {
  id: string;
  sessionId: string;
  sequence: number;
  createdAt: string;
  kind: "intent" | "routing" | "merge" | "conflict" | "agent" | "tool" | "checkpoint" | "verification" | "system";
  actor: string;
  title: string;
  detail: string;
  intentIds: string[];
  /** Connected reports are self-reported; omitted on legacy managed-worker events. */
  source?: "managed-worker" | "connected-agent";
  externalTrajectoryId?: string;
  actorUserId?: string;
  historyAction?: { action: "revise" | "restore"; target: { type: "intent" | "event" | "checkpoint"; id: string }; requestId: string; fromRevision: number; toRevision: number };
  turnId?: string;
}
export interface MemoryCheckpoint {
  intentState?: Array<Pick<Intent, "id" | "status" | "decision" | "resolution">>;
  /** Derived when reading a snapshot; never part of immutable checkpoint metadata. */
  restorable?: boolean;
  sourceEventIds?: string[];
  id: string; sessionId: string; createdAt: string; revision: number;
  summary: string; intentIds: string[]; decisions: string[];
  eventCount: number; contextChars: number; codexThreadId?: string;
}
export interface Presence { personId: PersonId; sessionId: string; seenAt: string }
export interface SessionSnapshot {
  session: Session;
  intents: Intent[];
  events: TrajectoryEvent[];
  checkpoints: MemoryCheckpoint[];
  presence: Presence[];
  participants: Participant[];
  currentUserId: string;
  worker: { online: boolean; engine: string; lastSeenAt?: string };
  storage: { mode: "atlas"; connected: boolean };
}
