import type { AgentState, NetworkNode, Scenario } from "./types";

export const SCENARIOS: Scenario[] = [
  {
    id: "ransomware",
    name: "Operation Blackout",
    subtitle: "Ransomware outbreak",
    description:
      "A compromised workstation begins encrypting the network. Contain lateral movement before the payload reaches the data vault.",
    difficulty: "HIGH",
    duration: "~90 sec",
    color: "#ff744b",
    entryNodeId: "workstation-01",
    targetNodeId: "data-vault",
    spreadInterval: 3,
    damagePerTick: 6,
    attackName: "BLACKOUT",
    technique: "T1486 · Data encrypted for impact",
    objectives: [
      "Detect patient zero",
      "Cut the lateral movement path",
      "Protect the data vault",
    ],
  },
  {
    id: "supply-chain",
    name: "Ghost in the Build",
    subtitle: "Supply chain intrusion",
    description:
      "A poisoned build artifact crosses your trust boundary. Trace the deployment path and isolate compromised infrastructure.",
    difficulty: "CRITICAL",
    duration: "~90 sec",
    color: "#bb8dff",
    entryNodeId: "build-server",
    targetNodeId: "api-server",
    spreadInterval: 2,
    damagePerTick: 5,
    attackName: "GHOST",
    technique: "T1195 · Supply chain compromise",
    objectives: [
      "Inspect artifact provenance",
      "Quarantine the build pipeline",
      "Preserve production uptime",
    ],
  },
  {
    id: "exfiltration",
    name: "Silent Siphon",
    subtitle: "Covert data exfiltration",
    description:
      "A stolen identity is moving quietly toward sensitive data. Follow the anomaly trail before the first records leave the network.",
    difficulty: "STEALTH",
    duration: "~90 sec",
    color: "#60b6ff",
    entryNodeId: "identity",
    targetNodeId: "data-vault",
    spreadInterval: 3,
    damagePerTick: 4,
    attackName: "SIPHON",
    technique: "T1041 · Exfiltration over C2 channel",
    objectives: [
      "Find the anomalous identity",
      "Reconstruct the intrusion route",
      "Stop outbound data transfer",
    ],
  },
];

export const NETWORK_LINKS: Array<[string, string]> = [
  ["gateway", "firewall"],
  ["firewall", "workstation-01"],
  ["firewall", "workstation-02"],
  ["firewall", "web-server"],
  ["workstation-01", "identity"],
  ["workstation-02", "identity"],
  ["workstation-01", "file-server"],
  ["workstation-02", "build-server"],
  ["identity", "api-server"],
  ["web-server", "api-server"],
  ["build-server", "api-server"],
  ["build-server", "file-server"],
  ["api-server", "database"],
  ["file-server", "database"],
  ["database", "data-vault"],
  ["database", "backup"],
  ["data-vault", "backup"],
];

const topology: Array<
  [
    string,
    string,
    NetworkNode["type"],
    NetworkNode["zone"],
    [number, number, number],
  ]
> = [
  ["gateway", "EDGE GATEWAY", "gateway", "perimeter", [-7, 0, -1]],
  ["firewall", "FIREWALL", "gateway", "perimeter", [-4.9, 0, -1]],
  [
    "workstation-01",
    "WORKSTATION 01",
    "workstation",
    "operations",
    [-3.1, 0, 2],
  ],
  [
    "workstation-02",
    "WORKSTATION 02",
    "workstation",
    "operations",
    [-3.1, 0, -3.9],
  ],
  ["web-server", "WEB SERVER", "server", "operations", [-1.6, 0, -1]],
  ["identity", "IDENTITY", "identity", "operations", [-0.7, 0, 2.4]],
  ["build-server", "BUILD SERVER", "server", "operations", [0, 0, -4.2]],
  ["file-server", "FILE SERVER", "storage", "operations", [2.2, 0, 3.1]],
  ["api-server", "API CLUSTER", "server", "core", [2, 0, -1.1]],
  ["database", "ATLAS DATABASE", "database", "core", [4.8, 0, 0.2]],
  ["data-vault", "DATA VAULT", "database", "core", [6.9, 0, -2]],
  ["backup", "BACKUP ARRAY", "storage", "core", [6.9, 0, 2.3]],
];

export function createNetwork(): NetworkNode[] {
  return topology.map(([id, label, type, zone, position]) => ({
    id,
    label,
    type,
    zone,
    position: [...position],
    status: "healthy",
    health: 100,
    risk: 0,
    detected: false,
    connections: NETWORK_LINKS.filter((edge) => edge.includes(id)).map(
      ([a, b]) => (a === id ? b : a),
    ),
  }));
}

export const AGENT_DEFINITIONS: AgentState[] = [
  {
    id: "sentinel",
    name: "SENTINEL",
    role: "Threat detection",
    color: "#6be4d2",
    status: "monitoring",
    task: "Watching network telemetry",
    confidence: 98,
    actions: 0,
  },
  {
    id: "cipher",
    name: "CIPHER",
    role: "Malware analysis",
    color: "#c399ff",
    status: "monitoring",
    task: "Inspecting behavior signatures",
    confidence: 96,
    actions: 0,
  },
  {
    id: "bastion",
    name: "BASTION",
    role: "Containment",
    color: "#ffb66c",
    status: "monitoring",
    task: "Holding the trust boundary",
    confidence: 99,
    actions: 0,
  },
  {
    id: "trace",
    name: "TRACE",
    role: "Digital forensics",
    color: "#81b8ff",
    status: "monitoring",
    task: "Correlating the evidence graph",
    confidence: 97,
    actions: 0,
  },
  {
    id: "nexus",
    name: "NEXUS",
    role: "Incident commander",
    color: "#f48eae",
    status: "monitoring",
    task: "Coordinating the defense team",
    confidence: 99,
    actions: 0,
  },
];

export function getScenario(id: string): Scenario {
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error("Unknown simulation scenario");
  return scenario;
}
