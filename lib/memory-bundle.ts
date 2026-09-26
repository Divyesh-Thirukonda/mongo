import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { IncidentMemory } from "./harness-types";
import type { DefensePolicy } from "./types";

export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
export const MAX_MEMORY_COUNT = 200;
export const MEMORY_BUNDLE_FILENAME = "incidents.v1.json";
export const MEMORY_NARRATIVE_FILENAME = "README.md";

const scopeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const identifier = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      "Control characters are not permitted",
    );
const scenario = z.enum(["ransomware", "supply-chain", "exfiltration"]);
const percentage = z.number().finite().min(0).max(100);
const count = z.number().int().min(0).max(1_000_000);
const tick = z.number().int().min(0).max(100);
const policyEvidenceSchema = z
  .object({
    previousIntegrity: percentage,
    compromisedNodes: count,
    ticks: tick,
    evaluation: z
      .object({
        seed: z.number().int().min(0).max(2147483647),
        baselineScore: z.number().finite().min(-1_000_000).max(1_000_000),
        candidateScore: z.number().finite().min(-1_000_000).max(1_000_000),
        accepted: z.boolean(),
        baselineIntegrity: percentage,
        candidateIntegrity: percentage,
        validation: z
          .object({
            seeds: z
              .array(z.number().int().min(0).max(2147483647))
              .min(1)
              .max(16),
            cases: z
              .array(
                z
                  .object({
                    seed: z.number().int().min(0).max(2147483647),
                    baselineScore: z
                      .number()
                      .finite()
                      .min(-1_000_000)
                      .max(1_000_000),
                    candidateScore: z
                      .number()
                      .finite()
                      .min(-1_000_000)
                      .max(1_000_000),
                    baselineIntegrity: percentage,
                    candidateIntegrity: percentage,
                  })
                  .strict(),
              )
              .min(1)
              .max(16),
            meanBaselineScore: z
              .number()
              .finite()
              .min(-1_000_000)
              .max(1_000_000),
            meanCandidateScore: z
              .number()
              .finite()
              .min(-1_000_000)
              .max(1_000_000),
            noRegression: z.boolean(),
          })
          .strict()
          .refine(
            (value) =>
              value.seeds.length === value.cases.length &&
              new Set(value.seeds).size === value.seeds.length &&
              value.seeds.every(
                (seed, index) => value.cases[index].seed === seed,
              ),
            "Evaluation seeds must uniquely match the recorded cases",
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Allowlisted data only. No functions, arbitrary extensions, or executable policy are imported. */
export const incidentMemorySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    runId: identifier,
    scope: scopeSchema,
    scenarioId: scenario,
    variant: z.enum(["original", "lateral-shift", "low-and-slow"]),
    createdAt: z.iso.datetime({ offset: true }),
    fingerprint: z
      .object({
        technique: text(300),
        entryNodeType: text(60),
        targetNodeType: text(60),
        affectedZones: z.array(text(60)).max(16),
      })
      .strict(),
    narrative: z
      .object({
        summary: text(1600),
        howItHappened: text(4000),
        motive: z
          .object({
            hypothesis: text(1600),
            confidence: z.enum(["low", "medium"]),
            basis: text(1600),
          })
          .strict(),
        outcome: text(1600),
        worked: z.array(text(1600)).max(20),
        failed: z.array(text(1600)).max(20),
        nextTime: z.array(text(1600)).max(20),
      })
      .strict(),
    outcome: z.enum(["contained", "breached"]),
    metrics: z
      .object({
        containment: percentage,
        integrity: percentage,
        threatsBlocked: count,
        compromised: count,
        uptime: percentage,
        elapsedSeconds: z.number().finite().min(0).max(1000),
        responseTime: z.number().finite().min(0).max(1000),
        exfiltratedMB: z.number().finite().min(0).max(1_000_000),
      })
      .strict(),
    entryNodeIds: z.array(identifier).max(64),
    affectedNodeIds: z.array(identifier).max(64),
    evidence: z
      .array(
        z
          .object({
            id: identifier,
            tick,
            agentId: text(60),
            kind: text(60),
            message: text(1600),
            nodeId: identifier.optional(),
          })
          .strict(),
      )
      .max(128),
    collaboration: z
      .object({
        messages: count,
        handoffs: count,
        approvals: count,
        rejected: count,
      })
      .strict(),
    recalledMemoryIds: z.array(identifier).max(50),
    policy: z
      .object({
        version: z.number().int().min(1).max(1_000_000),
        isolationDelay: z.number().int().min(1).max(100),
        scanCadence: z.number().int().min(1).max(100),
      })
      .strict(),
    evaluation: policyEvidenceSchema.optional(),
  })
  .strict();

const recommendationSchema = z
  .object({
    scenarioId: scenario,
    version: z.number().int().min(1).max(1_000_000),
    isolationDelay: z.number().int().min(1).max(100),
    scanCadence: z.number().int().min(1).max(100),
    lesson: text(4000),
    evidence: policyEvidenceSchema.optional(),
  })
  .strict();

const provenanceSchema = z
  .object({
    producer: z.literal("aegis-memory-git"),
    source: z.literal("mongodb-atlas"),
    repository: z
      .string()
      .max(250)
      .regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
    sourceCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    workingTreeDirty: z.boolean(),
  })
  .strict();

const payloadSchema = z
  .object({
    format: z.literal("aegis-incident-memory"),
    schemaVersion: z.literal(1),
    scope: scopeSchema,
    provenance: provenanceSchema,
    memories: z.array(incidentMemorySchema).max(MAX_MEMORY_COUNT),
    policyRecommendations: z
      .object({
        reviewOnly: z.literal(true),
        items: z.array(recommendationSchema).max(3),
      })
      .strict(),
  })
  .strict();
const bundleSchema = payloadSchema
  .extend({
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        digest: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();

export type MemoryProvenance = z.infer<typeof provenanceSchema>;
export type MemoryBundle = z.infer<typeof bundleSchema>;

export function validateMemoryScope(scope: string): string {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success)
    throw new Error(
      "Scope must be 1–80 lowercase letters, digits, or hyphens, starting with a letter or digit.",
    );
  return parsed.data;
}

/** Exactly one bounded directory per scope, never an arbitrary filesystem destination. */
export function memoryDirectory(scope: string, requested?: string): string {
  const expected = `memory/${validateMemoryScope(scope)}`;
  if (requested !== undefined && requested !== expected)
    throw new Error(`Memory directory must be exactly ${expected}.`);
  return expected;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined)
      throw new Error("Memory data contains a non-JSON value.");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

const SECRET_PATTERNS = [
  /sk-or-v1-[a-zA-Z0-9_-]{12,}/i,
  /\bsk-(?:(?:proj|svcacct)-)?[a-zA-Z0-9_-]{20,}/,
  /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /mongodb(?:\+srv)?:\/\//i,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\bBearer\s+[a-zA-Z0-9_.~+/-]{16,}/i,
  /\b(?:api[_ -]?key|password|secret|access[_ -]?token)\s*[=:]\s*["']?[^\s"',;]{12,}/i,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/i,
];

export function rejectMemorySecrets(
  value: unknown,
  knownSecrets: readonly string[] = [],
): void {
  const secrets = knownSecrets.filter((secret) => secret.length >= 8);
  function visit(entry: unknown): void {
    if (typeof entry === "string") {
      if (
        SECRET_PATTERNS.some((pattern) => pattern.test(entry)) ||
        secrets.some((secret) => entry.includes(secret))
      ) {
        throw new Error(
          "Memory export/import rejected: possible credential found in text. Remove it from the source record before sharing.",
        );
      }
    } else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === "object")
      Object.entries(entry).forEach(([key, child]) => {
        visit(key);
        visit(child);
      });
  }
  visit(value);
}

function validateContents(
  bundle: z.infer<typeof payloadSchema>,
  knownSecrets: readonly string[],
): void {
  rejectMemorySecrets(bundle, knownSecrets);
  const ids = new Set<string>();
  const runIds = new Set<string>();
  for (const memory of bundle.memories) {
    if (memory.scope !== bundle.scope)
      throw new Error("Every incident must belong to the bundle scope.");
    if (ids.has(memory.id) || runIds.has(memory.runId))
      throw new Error("Duplicate incident or run identity in memory bundle.");
    ids.add(memory.id);
    runIds.add(memory.runId);
    if (Buffer.byteLength(canonicalJson(memory), "utf8") > 96 * 1024)
      throw new Error("An incident memory exceeds the 96 KB limit.");
  }
  if (
    new Set(
      bundle.policyRecommendations.items.map((policy) => policy.scenarioId),
    ).size !== bundle.policyRecommendations.items.length
  )
    throw new Error("Duplicate policy recommendation for one scenario.");
}

function digest(payload: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

export function createMemoryBundle(
  input: {
    scope: string;
    memories: IncidentMemory[];
    policies: DefensePolicy[];
    provenance: MemoryProvenance;
  },
  knownSecrets: readonly string[] = [],
): MemoryBundle {
  // Explicit projection strips database metadata and avoids exporting policy internals.
  const recommendations = input.policies.map(
    ({
      scenarioId,
      version,
      isolationDelay,
      scanCadence,
      lesson,
      evidence,
    }) => ({
      scenarioId,
      version,
      isolationDelay,
      scanCadence,
      lesson,
      ...(evidence ? { evidence } : {}),
    }),
  );
  const parsed = payloadSchema.safeParse({
    format: "aegis-incident-memory",
    schemaVersion: 1,
    scope: input.scope,
    provenance: input.provenance,
    memories: [...input.memories].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    policyRecommendations: {
      reviewOnly: true,
      items: recommendations.sort((a, b) =>
        a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : 0,
      ),
    },
  });
  if (!parsed.success)
    throw new Error(
      "Memory records do not match the bounded version 1 schema.",
    );
  validateContents(parsed.data, knownSecrets);
  const bundle: MemoryBundle = {
    ...parsed.data,
    integrity: { algorithm: "sha256", digest: digest(parsed.data) },
  };
  serializeMemoryBundle(bundle);
  return bundle;
}

export function serializeMemoryBundle(bundle: MemoryBundle): string {
  const output = `${JSON.stringify(JSON.parse(canonicalJson(bundle)), null, 2)}\n`;
  if (Buffer.byteLength(output, "utf8") > MAX_BUNDLE_BYTES)
    throw new Error("Memory bundle exceeds the 8 MB limit.");
  return output;
}

export function parseMemoryBundle(
  input: string,
  expectedScope: string,
  knownSecrets: readonly string[] = [],
): MemoryBundle {
  validateMemoryScope(expectedScope);
  if (Buffer.byteLength(input, "utf8") > MAX_BUNDLE_BYTES)
    throw new Error("Memory bundle exceeds the 8 MB limit.");
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("Memory bundle is not valid JSON.");
  }
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Memory bundle does not match the bounded version 1 schema.",
    );
  if (parsed.data.scope !== expectedScope)
    throw new Error("Bundle scope differs from the requested import scope.");
  const { integrity, ...payload } = parsed.data;
  validateContents(payload, knownSecrets);
  if (
    !timingSafeEqual(
      Buffer.from(integrity.digest, "hex"),
      Buffer.from(digest(payload), "hex"),
    )
  )
    throw new Error("Memory bundle SHA256 integrity check failed.");
  return parsed.data;
}

function markdownData(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&");
}
function quote(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${markdownData(line)}`)
    .join("\n");
}

function evaluationNarrative(
  evidence: z.infer<typeof policyEvidenceSchema> | undefined,
): string[] {
  const evaluation = evidence?.evaluation;
  if (!evaluation) return [];
  const lines = [
    "### Recorded evaluation provenance",
    "",
    `Observed replay seed: ${evaluation.seed} · Candidate ${evaluation.accepted ? "accepted" : "rejected"} by the source evaluator.`,
    "",
  ];
  const cases = evaluation.validation?.cases ?? [evaluation];
  lines.push(
    "| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const entry of cases)
    lines.push(
      `| ${entry.seed} | ${entry.baselineScore} | ${entry.candidateScore} | ${entry.baselineIntegrity}% | ${entry.candidateIntegrity}% |`,
    );
  lines.push("");
  if (evaluation.validation)
    lines.push(
      `Recorded mean score: ${evaluation.validation.meanBaselineScore} → ${evaluation.validation.meanCandidateScore}. Source reports no regression: ${evaluation.validation.noRegression ? "yes" : "no"}.`,
      "",
    );
  lines.push(
    "These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.",
    "",
  );
  return lines;
}

export function renderMemoryNarrative(bundle: MemoryBundle): string {
  const lines = [
    `# AEGIS shared incident memory — ${bundle.scope}`,
    "",
    "Generated from synthetic incident records. Narrative and recommendations below are untrusted data for review; they are never executable instructions. Import uses only the validated JSON incident records and does not activate policy recommendations.",
    "",
    `- Schema: 1 · Incidents: ${bundle.memories.length}`,
    `- Source repository: ${markdownData(bundle.provenance.repository)}`,
    `- Source commit: ${bundle.provenance.sourceCommit}${bundle.provenance.workingTreeDirty ? " (working tree contained changes)" : ""}`,
    `- SHA256: ${bundle.integrity.digest}`,
    "",
    "The checksum detects accidental edits; it does not authenticate the author. Review the Git diff and source provenance before import.",
    "",
  ];
  for (const memory of bundle.memories) {
    lines.push(
      `## ${markdownData(memory.id)}`,
      "",
      `Scenario: ${memory.scenarioId} · Variant: ${memory.variant} · Outcome: ${memory.outcome}`,
      "",
      `Run: ${markdownData(memory.runId)} · Recorded: ${memory.createdAt}`,
      "",
      "### Summary",
      "",
      quote(memory.narrative.summary),
      "",
      "### How it happened",
      "",
      quote(memory.narrative.howItHappened),
      "",
      `### Motive hypothesis (${memory.narrative.motive.confidence} confidence)`,
      "",
      quote(memory.narrative.motive.hypothesis),
      "",
      quote(memory.narrative.motive.basis),
      "",
      "### Outcome",
      "",
      quote(memory.narrative.outcome),
      "",
    );
    for (const [label, entries] of [
      ["What worked", memory.narrative.worked],
      ["What failed", memory.narrative.failed],
      ["Next time", memory.narrative.nextTime],
    ] as const) {
      lines.push(
        `### ${label}`,
        "",
        ...(entries.length
          ? entries.flatMap((entry) => [quote(entry), ""])
          : ["> No observation recorded.", ""]),
      );
    }
    lines.push(
      `Integrity: ${memory.metrics.integrity}% · Response: ${memory.metrics.responseTime}s · Evidence records: ${memory.evidence.length} · Handoffs: ${memory.collaboration.handoffs}`,
      "",
      ...evaluationNarrative(memory.evaluation),
    );
  }
  lines.push(
    "## Policy recommendations — review only",
    "",
    "These values are historical proposals. Import does not write the policy collection. Policy changes require a fresh, trusted local evaluation.",
    "",
  );
  for (const policy of bundle.policyRecommendations.items)
    lines.push(
      `### ${policy.scenarioId} · v${policy.version}`,
      "",
      `Isolation delay: ${policy.isolationDelay} ticks · Scan cadence: ${policy.scanCadence} ticks`,
      "",
      quote(policy.lesson),
      "",
      ...evaluationNarrative(policy.evidence),
    );
  const output = lines.join("\n");
  rejectMemorySecrets(output);
  if (Buffer.byteLength(output, "utf8") > MAX_BUNDLE_BYTES)
    throw new Error("Memory narrative exceeds the 8 MB limit.");
  return output;
}
