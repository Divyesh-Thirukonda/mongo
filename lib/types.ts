export type ScenarioId = "ransomware" | "supply-chain" | "exfiltration";
export type AgentId = "sentinel" | "cipher" | "bastion" | "trace" | "nexus";
export type NodeStatus = "healthy" | "exposed" | "compromised" | "isolated";
export type RunStatus = "ready" | "running" | "contained" | "breached";

export interface NetworkNode {
  id: string;
  label: string;
  type:
    "gateway" | "workstation" | "server" | "database" | "identity" | "storage";
  zone: "perimeter" | "operations" | "core";
  position: [number, number, number];
  status: NodeStatus;
  health: number;
  risk: number;
  detected: boolean;
  connections: string[];
  compromisedAt?: number;
  isolatedAt?: number;
}

export interface AgentState {
  id: AgentId;
  name: string;
  role: string;
  color: string;
  status: "monitoring" | "analyzing" | "defending" | "complete";
  task: string;
  confidence: number;
  actions: number;
  targetNodeId?: string;
}

export interface SimulationEvent {
  id: string;
  tick: number;
  agentId: AgentId | "attacker" | "commander" | "system";
  kind:
    | "system"
    | "detection"
    | "analysis"
    | "attack"
    | "defense"
    | "recovery"
    | "decision";
  message: string;
  nodeId?: string;
  confidence?: number;
  source?: "simulation" | "openrouter" | "human";
}

export interface RunMetrics {
  containment: number;
  integrity: number;
  threatsBlocked: number;
  compromised: number;
  uptime: number;
  elapsedSeconds: number;
  responseTime: number;
  exfiltratedMB: number;
}

export interface SimulationRun {
  id: string;
  scenarioId: ScenarioId;
  status: RunStatus;
  tick: number;
  seed: number;
  revision: number;
  nodes: NetworkNode[];
  events: SimulationEvent[];
  metrics: RunMetrics;
  agents: AgentState[];
  autoDefend: boolean;
  createdAt: string;
  updatedAt: string;
  ai: {
    enabled: boolean;
    mode: "simulation" | "openrouter";
    requests: number;
    tokens: number;
    lastTick: number;
    error?: string;
    model?: string;
  };
  attack: { stage: number; wavesSpawned: number; lastSpreadTick: number };
  history: Array<{
    tick: number;
    integrity: number;
    containment: number;
    compromised: number;
  }>;
  snapshots: Array<{ tick: number; nodes: NetworkNode[]; metrics: RunMetrics }>;
  policy: DefensePolicy;
  learned?: boolean;
}

export interface DefensePolicy {
  scenarioId: ScenarioId;
  version: number;
  isolationDelay: number;
  scanCadence: number;
  learnedFrom: string[];
  lesson: string;
  updatedAt?: string;
  evidence?: {
    previousIntegrity: number;
    compromisedNodes: number;
    ticks: number;
    evaluation?: {
      seed: number;
      baselineScore: number;
      candidateScore: number;
      accepted: boolean;
      baselineIntegrity: number;
      candidateIntegrity: number;
    };
  };
}

export type Run = SimulationRun;
export type RunAction =
  | { type: "isolate" | "restore" | "scan"; nodeId: string }
  | { type: "auto-defend"; enabled: boolean };

export interface Scenario {
  id: ScenarioId;
  name: string;
  subtitle: string;
  description: string;
  difficulty: "HIGH" | "CRITICAL" | "STEALTH";
  duration: string;
  color: string;
  entryNodeId: string;
  targetNodeId: string;
  spreadInterval: number;
  damagePerTick: number;
  attackName: string;
  technique: string;
  objectives: string[];
}

export interface StorageStatus {
  mode: "atlas" | "memory";
  persisted: boolean;
}
export interface RunResponse {
  run: SimulationRun;
  storage: StorageStatus;
}
