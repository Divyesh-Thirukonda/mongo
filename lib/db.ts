import "server-only";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { buildIncidentMemory } from "./incident-memory";
import type { Campaign, IncidentMemory } from "./harness-types";
import { baselinePolicy, derivePolicy } from "./simulation";
import { SCENARIOS } from "./scenarios";
import type {
  DefensePolicy,
  ScenarioId,
  SimulationRun,
  StorageStatus,
} from "./types";

type RunDoc = SimulationRun & {
  _id: string;
  expiresAt?: Date;
  leaseToken?: string;
  leaseUntil?: Date;
};
type PolicyDoc = DefensePolicy & { _id: string };
type BudgetDoc = { _id: string; count: number; expiresAt: Date };
type Store = {
  client?: Promise<MongoClient>;
  initialized?: Promise<void>;
  initializedVersion?: number;
  memories: Map<string, IncidentMemory>;
  campaigns: Map<string, Campaign>;
  runs: Map<string, SimulationRun>;
  policies: Map<string, DefensePolicy>;
  locks: Set<string>;
  budgets: Map<string, number>;
};
const globalStore = globalThis as typeof globalThis & { aegisStore?: Store };
const store: Store = (globalStore.aegisStore ??= {
  memories: new Map(),
  campaigns: new Map(),
  runs: new Map(),
  policies: new Map(),
  locks: new Set(),
  budgets: new Map(),
});

store.memories ??= new Map();
store.campaigns ??= new Map();

export class StoreError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}

export function storageStatus(): StorageStatus {
  return {
    mode: process.env.MONGODB_URI ? "atlas" : "memory",
    persisted: Boolean(process.env.MONGODB_URI),
  };
}

async function database(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!store.client) {
    store.client = new MongoClient(uri, {
      maxPoolSize: 8,
      serverSelectionTimeoutMS: 6000,
      connectTimeoutMS: 6000,
    })
      .connect()
      .catch(() => {
        store.client = undefined;
        throw new StoreError(
          "MongoDB Atlas is configured but unavailable. Check the database credentials and network access list.",
        );
      });
  }
  const client = await store.client;
  const db = client.db(process.env.MONGODB_DB ?? "aegis");
  if (store.initializedVersion !== 3) {
    store.initialized = undefined;
    store.initializedVersion = 3;
  }
  if (!store.initialized) {
    store.initialized = Promise.all([
      db
        .collection("incident_memories")
        .createIndex({ scope: 1, scenarioId: 1, createdAt: -1 }),
      db.collection("incident_memories").createIndex({
        scope: 1,
        scenarioId: 1,
        outcome: 1,
        "metrics.integrity": -1,
      }),
      db.collection("campaigns").createIndex({ createdAt: -1 }),
      db.collection("policies").createIndex({ scenarioId: 1 }),
      db.collection("runs").createIndex({ createdAt: -1 }),
      db
        .collection("runs")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("events").createIndex({ runId: 1, tick: 1 }),
      db
        .collection("events")
        .createIndex({ runId: 1, eventId: 1 }, { unique: true }),
      db
        .collection("events")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db
        .collection("budgets")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ])
      .then(() => undefined)
      .catch(() => {
        store.initialized = undefined;
        throw new StoreError(
          "Connected to MongoDB, but the application could not initialize its collections.",
        );
      });
  }
  await store.initialized;
  return db;
}

function clean(doc: RunDoc): SimulationRun {
  const {
    _id: _id,
    expiresAt: _expiresAt,
    leaseToken: _leaseToken,
    leaseUntil: _leaseUntil,
    ...run
  } = doc;
  return run;
}

async function writeEvents(db: Db, run: SimulationRun): Promise<void> {
  if (!run.events.length) return;
  const expiresAt = new Date(Date.now() + 7 * 86400_000);
  await db.collection("events").bulkWrite(
    run.events.map((event) => ({
      updateOne: {
        filter: { runId: run.id, eventId: event.id },
        update: {
          $setOnInsert: {
            ...event,
            eventId: event.id,
            runId: run.id,
            scenarioId: run.scenarioId,
            expiresAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function getDatabaseHealth(): Promise<{
  mode: "atlas" | "memory";
  connected: boolean;
  message: string;
}> {
  if (!process.env.MONGODB_URI)
    return {
      mode: "memory",
      connected: false,
      message:
        "Local demo memory. Set MONGODB_URI to persist exercises and learned policies in Atlas.",
    };
  try {
    const db = await database();
    await db!.command({ ping: 1 });
    return {
      mode: "atlas",
      connected: true,
      message:
        "MongoDB Atlas connected. Exercises, evidence, and learned policies persist across sessions.",
    };
  } catch (error) {
    return {
      mode: "atlas",
      connected: false,
      message:
        error instanceof StoreError
          ? error.message
          : "MongoDB Atlas connection failed.",
    };
  }
}

export async function insertRun(run: SimulationRun): Promise<void> {
  const db = await database();
  if (!db) {
    if (store.runs.size >= 200)
      store.runs.delete(store.runs.keys().next().value!);
    store.runs.set(run.id, structuredClone(run));
    return;
  }
  await db.collection<RunDoc>("runs").insertOne({
    ...run,
    _id: run.id,
    ...(run.campaign
      ? {}
      : { expiresAt: new Date(Date.now() + 7 * 86400_000) }),
  });
  // Every event also lives inside the atomic run snapshot; this collection is a queryable evidence projection.
  await writeEvents(db, run);
}

export async function getRun(id: string): Promise<SimulationRun | null> {
  const db = await database();
  const doc = db
    ? await db.collection<RunDoc>("runs").findOne({ _id: id })
    : null;
  const run = db
    ? doc
      ? clean(doc)
      : null
    : structuredClone(store.runs.get(id) ?? null);
  // Repair interrupted finalization from a committed terminal snapshot.
  if (run && !run.learned && ["contained", "breached"].includes(run.status)) {
    await learn(run, db);
    if (!db) store.runs.set(id, structuredClone(run));
  }
  return run;
}

export async function listRuns(): Promise<SimulationRun[]> {
  const db = await database();
  if (!db)
    return [...store.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((run) => structuredClone(run));
  return (
    await db
      .collection<RunDoc>("runs")
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()
  ).map(clean);
}

export async function getPolicy(
  scenarioId: ScenarioId,
  scope = "shared",
): Promise<DefensePolicy> {
  const key = policyKey(scope, scenarioId);
  const db = await database();
  if (!db)
    return structuredClone(
      store.policies.get(key) ?? baselinePolicy(scenarioId),
    );
  const policy = await db
    .collection<PolicyDoc>("policies")
    .findOne({ _id: key });
  if (!policy) return baselinePolicy(scenarioId);
  const { _id: _id, ...result } = policy;
  return result;
}

export async function listPolicies(scope = "shared"): Promise<DefensePolicy[]> {
  return Promise.all(
    SCENARIOS.map((scenario) => getPolicy(scenario.id, scope)),
  );
}

export function validateMemoryScope(scope: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(scope))
    throw new StoreError("Invalid memory scope", 400);
  return scope;
}
function policyKey(scope: string, scenarioId: ScenarioId): string {
  validateMemoryScope(scope);
  return scope === "shared" ? scenarioId : `${scope}:${scenarioId}`;
}

type MemoryDoc = IncidentMemory & { _id: string };
function memoryKey(memory: Pick<IncidentMemory, "scope" | "id">) {
  return `${memory.scope}:${memory.id}`;
}
function cleanMemory(doc: MemoryDoc): IncidentMemory {
  const { _id, ...memory } = doc;
  return memory;
}

export async function listIncidentMemories(
  scope = "shared",
  limit = 200,
  scenarioId?: ScenarioId,
): Promise<IncidentMemory[]> {
  validateMemoryScope(scope);
  const cap = Math.max(1, Math.min(200, Math.floor(limit)));
  const db = await database();
  if (!db)
    return [...store.memories.values()]
      .filter(
        (m) =>
          m.scope === scope && (!scenarioId || m.scenarioId === scenarioId),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      )
      .slice(0, cap)
      .map((m) => structuredClone(m));
  return (
    await db
      .collection<MemoryDoc>("incident_memories")
      .find({ scope, ...(scenarioId ? { scenarioId } : {}) })
      .sort({ createdAt: -1, _id: 1 })
      .limit(cap)
      .toArray()
  ).map(cleanMemory);
}

export async function importIncidentMemories(
  memories: IncidentMemory[],
  scope = "shared",
): Promise<{ inserted: number; existing: number }> {
  validateMemoryScope(scope);
  if (memories.length > 200 || memories.some((m) => m.scope !== scope))
    throw new StoreError("Memory import scope or size mismatch", 400);
  const db = await database();
  // Compare normalized JSON independent of object-key insertion order.
  const canonical = (value: unknown): string =>
    JSON.stringify(value, function (_key, item) {
      return item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
          )
        : item;
    });
  if (new Set(memories.map(memoryKey)).size !== memories.length)
    throw new StoreError("Duplicate memory identity in import", 400);
  if (!db) {
    let existing = 0;
    // Preflight the whole batch before mutating the local adapter.
    for (const memory of memories) {
      const key = memoryKey(memory);
      const prior = store.memories.get(key);
      if (prior && canonical(prior) !== canonical(memory))
        throw new StoreError("Conflicting immutable memory ID", 409);
      if (prior) existing++;
    }
    for (const memory of memories) {
      if (!store.memories.has(memoryKey(memory)))
        store.memories.set(memoryKey(memory), structuredClone(memory));
    }
    return { inserted: memories.length - existing, existing };
  }
  const client = await store.client!;
  return client.withSession((session) =>
    session.withTransaction(
      async () => {
        // Counters belong to the transaction attempt; retries must not double-count.
        let inserted = 0,
          existing = 0;
        const collection = db.collection<MemoryDoc>("incident_memories");
        for (const memory of memories) {
          const key = memoryKey(memory);
          const prior = await collection.findOne({ _id: key }, { session });
          if (prior) {
            if (canonical(cleanMemory(prior)) !== canonical(memory))
              throw new StoreError("Conflicting immutable memory ID", 409);
            existing++;
          } else {
            await collection.insertOne({ ...memory, _id: key }, { session });
            inserted++;
          }
        }
        return { inserted, existing };
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    ),
  );
}

/** Mix recent cases with durable successes and failures so old lessons survive a busy incident stream. */
export async function recallCandidates(
  scope: string,
  scenarioId: ScenarioId,
): Promise<IncidentMemory[]> {
  validateMemoryScope(scope);
  const db = await database();
  if (!db) {
    const all = [...store.memories.values()].filter(
      (m) => m.scope === scope && m.scenarioId === scenarioId,
    );
    const recent = [...all]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 24);
    const anchors = [...all]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 5);
    const failures = all.filter((m) => m.outcome === "breached").slice(-5);
    return [
      ...new Map(
        [...recent, ...anchors, ...failures].map((m) => [m.id, m]),
      ).values(),
    ].map((m) => structuredClone(m));
  }
  const collection = db.collection<MemoryDoc>("incident_memories");
  const filter = { scope, scenarioId };
  const groups = await Promise.all([
    collection.find(filter).sort({ createdAt: -1 }).limit(24).toArray(),
    collection.find(filter).sort({ createdAt: 1 }).limit(5).toArray(),
    collection
      .find({ ...filter, outcome: "contained" })
      .sort({ "metrics.integrity": -1, createdAt: -1 })
      .limit(5)
      .toArray(),
    collection
      .find({ ...filter, outcome: "breached" })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray(),
  ]);
  return [
    ...new Map(
      groups.flat().map((doc) => [doc._id, cleanMemory(doc)]),
    ).values(),
  ];
}

async function learn(run: SimulationRun, db: Db | null): Promise<void> {
  if (run.learned || !["contained", "breached"].includes(run.status)) return;
  const scope = validateMemoryScope(run.memoryScope ?? "shared");
  const key = policyKey(scope, run.scenarioId);
  const incidentKey = `${scope}:${run.id}`;
  if (!db) {
    if (!store.memories.has(incidentKey)) {
      const policy = store.policies.get(key) ?? baselinePolicy(run.scenarioId);
      const next = derivePolicy(run, policy);
      store.memories.set(incidentKey, buildIncidentMemory(run, next));
      store.policies.set(key, next);
    }
    run.learned = true;
    return;
  }
  const client = await store.client!;
  await client.withSession(async (session) => {
    await session.withTransaction(
      async () => {
        const memories = db.collection<MemoryDoc>("incident_memories");
        const alreadyLearned = await memories.findOne(
          { _id: incidentKey },
          { session },
        );
        if (!alreadyLearned) {
          const collection = db.collection<PolicyDoc>("policies");
          const previous = await collection.findOne({ _id: key }, { session });
          const next = derivePolicy(
            run,
            previous ?? baselinePolicy(run.scenarioId),
          );
          const memory = buildIncidentMemory(run, next);
          await memories.insertOne(
            { ...memory, _id: incidentKey },
            { session },
          );
          await collection.replaceOne(
            { _id: key },
            { ...next },
            { upsert: true, session },
          );
        }
        await db
          .collection<RunDoc>("runs")
          .updateOne({ _id: run.id }, { $set: { learned: true } }, { session });
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  });
  run.learned = true;
}

/** Leases serialize per-run mutations across serverless instances and protect paid AI calls. */
export async function mutateRun(
  id: string,
  update: (run: SimulationRun) => Promise<SimulationRun> | SimulationRun,
): Promise<SimulationRun> {
  const db = await database();
  if (!db) {
    if (store.locks.has(id))
      throw new StoreError(
        "An update to this exercise is already in progress.",
        409,
      );
    const existing = store.runs.get(id);
    if (!existing) throw new StoreError("Exercise not found", 404);
    store.locks.add(id);
    try {
      const next = await update(structuredClone(existing));
      await learn(next, null);
      store.runs.set(id, structuredClone(next));
      return next;
    } finally {
      store.locks.delete(id);
    }
  }
  const token = randomUUID();
  const collection = db.collection<RunDoc>("runs");
  const acquired = await collection.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: { $lt: new Date() } },
      ],
    },
    { $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 30000) } },
    { returnDocument: "after" },
  );
  if (!acquired) {
    if (!(await collection.findOne({ _id: id }, { projection: { _id: 1 } })))
      throw new StoreError("Exercise not found", 404);
    throw new StoreError(
      "An update to this exercise is already in progress.",
      409,
    );
  }
  try {
    const next = await update(clean(acquired));
    // Commit the canonical snapshot first. Evidence projections and learning may only consume committed state.
    const committed = await collection.replaceOne(
      { _id: id, leaseToken: token, leaseUntil: { $gt: new Date() } },
      {
        ...next,
        expiresAt: acquired.expiresAt,
        leaseToken: token,
        leaseUntil: acquired.leaseUntil,
      },
    );
    if (!committed.matchedCount)
      throw new StoreError(
        "The exercise changed while this action was running. Refresh and retry.",
        409,
      );
    await writeEvents(db, next);
    await learn(next, db);
    const result = await collection.updateOne(
      { _id: id, leaseToken: token },
      { $set: { learned: next.learned ?? false } },
    );
    if (!result.matchedCount)
      throw new StoreError(
        "The exercise changed while this action was running. Refresh and retry.",
        409,
      );
    return next;
  } finally {
    await collection.updateOne(
      { _id: id, leaseToken: token },
      { $unset: { leaseToken: "", leaseUntil: "" } },
    );
  }
}

/** Durable hourly quota in Atlas; the memory fallback is deliberately local to one process. */
export async function claimBudget(
  scope: string,
  limit: number,
  windowSeconds = 3600,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${scope}:${bucket}`;
  const db = await database();
  if (!db) {
    const current = store.budgets.get(key) ?? 0;
    if (current >= limit) return false;
    store.budgets.set(key, current + 1);
    if (store.budgets.size > 1000)
      store.budgets.delete(store.budgets.keys().next().value!);
    return true;
  }
  const collection = db.collection<BudgetDoc>("budgets");
  try {
    const result = await collection.findOneAndUpdate(
      { _id: key, count: { $lt: limit } },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          expiresAt: new Date((bucket + 2) * windowSeconds * 1000),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return Boolean(result);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    )
      return false;
    throw error;
  }
}

type CampaignDoc = Campaign & {
  _id: string;
  leaseToken?: string;
  leaseUntil?: Date;
};
function cleanCampaign(doc: CampaignDoc): Campaign {
  const { _id, leaseToken, leaseUntil, ...campaign } = doc;
  return campaign;
}
export async function insertCampaign(campaign: Campaign): Promise<void> {
  const db = await database();
  if (!db) {
    if (store.campaigns.has(campaign.id))
      throw new StoreError("Campaign already exists", 409);
    store.campaigns.set(campaign.id, structuredClone(campaign));
    return;
  }
  await db
    .collection<CampaignDoc>("campaigns")
    .insertOne({ ...campaign, _id: campaign.id });
}
export async function getCampaign(id: string): Promise<Campaign | null> {
  const db = await database();
  if (!db) return structuredClone(store.campaigns.get(id) ?? null);
  const doc = await db
    .collection<CampaignDoc>("campaigns")
    .findOne({ _id: id });
  return doc ? cleanCampaign(doc) : null;
}
export async function listCampaigns(): Promise<Campaign[]> {
  const db = await database();
  if (!db)
    return [...store.campaigns.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((c) => structuredClone(c));
  return (
    await db
      .collection<CampaignDoc>("campaigns")
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()
  ).map(cleanCampaign);
}
export async function mutateCampaign(
  id: string,
  update: (campaign: Campaign) => Promise<Campaign>,
): Promise<Campaign> {
  const db = await database();
  const lockKey = `campaign:${id}`;
  if (!db) {
    if (store.locks.has(lockKey))
      throw new StoreError("Campaign advancement already in progress", 409);
    const current = store.campaigns.get(id);
    if (!current) throw new StoreError("Campaign not found", 404);
    store.locks.add(lockKey);
    try {
      const next = await update(structuredClone(current));
      store.campaigns.set(id, structuredClone(next));
      return next;
    } finally {
      store.locks.delete(lockKey);
    }
  }
  const collection = db.collection<CampaignDoc>("campaigns");
  const token = randomUUID();
  const acquired = await collection.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { leaseUntil: { $exists: false } },
        { leaseUntil: { $lt: new Date() } },
      ],
    },
    { $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 30000) } },
    { returnDocument: "after" },
  );
  if (!acquired)
    throw new StoreError("Campaign missing or already advancing", 409);
  try {
    const next = await update(cleanCampaign(acquired));
    const result = await collection.replaceOne(
      { _id: id, leaseToken: token, leaseUntil: { $gt: new Date() } },
      { ...next, leaseToken: token, leaseUntil: acquired.leaseUntil },
    );
    if (!result.matchedCount)
      throw new StoreError(
        "Campaign lease expired; resume from its saved checkpoint",
        409,
      );
    return next;
  } finally {
    await collection.updateOne(
      { _id: id, leaseToken: token },
      { $unset: { leaseToken: "", leaseUntil: "" } },
    );
  }
}
export async function closeDatabaseConnection(): Promise<void> {
  if (store.client) await (await store.client).close();
  store.client = undefined;
  store.initialized = undefined;
}
