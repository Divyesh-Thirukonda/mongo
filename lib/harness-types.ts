import type { AgentId, DefensePolicy, RunMetrics, ScenarioId } from "./types";

export type IncidentVariant = "original" | "lateral-shift" | "low-and-slow";
export interface MemoryMatch {
  memoryId: string;
  runId: string;
  similarity: number;
  relationship: "exact" | "related";
  summary: string;
  outcome: "contained" | "breached";
  reason: string;
}
export interface MemoryRecall {
  matches: MemoryMatch[];
  watchNodeIds: string[];
  anticipate: boolean;
  context: string;
  contextChars: number;
  maxContextChars: number;
  considered: number;
}
export interface HarnessMessage {
  id: string;
  tick: number;
  from: AgentId;
  to: AgentId | "team";
  kind:
    | "observation"
    | "assessment"
    | "proposal"
    | "approval"
    | "execution"
    | "handoff"
    | "recall";
  nodeId?: string;
  content: string;
  evidenceIds: string[];
  inReplyTo?: string;
}
export interface HarnessTask {
  id: string;
  nodeId: string;
  owner: AgentId;
  status: "open" | "investigating" | "approved" | "contained";
  evidenceIds: string[];
  assessment?: string;
  approvedBy?: "nexus";
  executedBy?: "bastion";
}
export interface HarnessState {
  version: 1;
  phase: "monitor" | "triage" | "contain" | "recover" | "review";
  recall: MemoryRecall;
  messages: HarnessMessage[];
  tasks: HarnessTask[];
  contextCompactions: number;
  compactedSummary: string;
  guardrailRejections: number;
}
export interface IncidentMemory {
  schemaVersion: 1;
  id: string;
  runId: string;
  scope: string;
  scenarioId: ScenarioId;
  variant: IncidentVariant;
  createdAt: string;
  fingerprint: {
    technique: string;
    entryNodeType: string;
    targetNodeType: string;
    affectedZones: string[];
  };
  narrative: {
    summary: string;
    howItHappened: string;
    motive: { hypothesis: string; confidence: "low" | "medium"; basis: string };
    outcome: string;
    worked: string[];
    failed: string[];
    nextTime: string[];
  };
  outcome: "contained" | "breached";
  metrics: RunMetrics;
  entryNodeIds: string[];
  affectedNodeIds: string[];
  evidence: Array<{
    id: string;
    tick: number;
    agentId: string;
    kind: string;
    message: string;
    nodeId?: string;
  }>;
  collaboration: {
    messages: number;
    handoffs: number;
    approvals: number;
    rejected: number;
  };
  recalledMemoryIds: string[];
  policy: { version: number; isolationDelay: number; scanCadence: number };
  evaluation?: DefensePolicy["evidence"];
}
export interface Campaign {
  id: string;
  scope: string;
  scenarioId: ScenarioId;
  status: "running" | "complete";
  totalEpisodes: number;
  completedEpisodes: number;
  activeRunId?: string;
  activeRunTick?: number;
  runIds: string[];
  seed: number;
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  results: Array<{
    episode: number;
    runId: string;
    variant: IncidentVariant;
    integrity: number;
    responseTime: number;
    outcome: string;
    recalled: number;
    anticipated: boolean;
    policyVersion: number;
  }>;
}
