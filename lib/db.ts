import "server-only";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
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
  expiresAt: Date;
  leaseToken?: string;
  leaseUntil?: Date;
};
type PolicyDoc = DefensePolicy & { _id: string };
type BudgetDoc = { _id: string; count: number; expiresAt: Date };
type Store = {
  client?: Promise<MongoClient>;
  initialized?: Promise<void>;
  runs: Map<string, SimulationRun>;
  policies: Map<string, DefensePolicy>;
  locks: Set<string>;
  budgets: Map<string, number>;
};
const globalStore = globalThis as typeof globalThis & { aegisStore?: Store };
const store: Store = (globalStore.aegisStore ??= {
  runs: new Map(),
  policies: new Map(),
  locks: new Set(),
  budgets: new Map(),
});

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
  if (!store.initialized) {
    store.initialized = Promise.all([
      db.collection("runs").createIndex({ createdAt: -1 }),
      db
        .collection("runs")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection("events").createIndex({ runId: 1, tick: 1 }),
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
  await db
    .collection<RunDoc>("runs")
    .insertOne({
      ...run,
      _id: run.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    });
  // Every event also lives inside the atomic run snapshot; this collection is a queryable evidence projection.
  await writeEvents(db, run);
}

export async function getRun(id: string): Promise<SimulationRun | null> {
  const db = await database();
  if (!db) return structuredClone(store.runs.get(id) ?? null);
  const run = await db.collection<RunDoc>("runs").findOne({ _id: id });
  return run ? clean(run) : null;
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
): Promise<DefensePolicy> {
  const db = await database();
  if (!db)
    return structuredClone(
      store.policies.get(scenarioId) ?? baselinePolicy(scenarioId),
    );
  const policy = await db
    .collection<PolicyDoc>("policies")
    .findOne({ _id: scenarioId });
  if (!policy) return baselinePolicy(scenarioId);
  const { _id: _id, ...result } = policy;
  return result;
}

export async function listPolicies(): Promise<DefensePolicy[]> {
  return Promise.all(SCENARIOS.map((scenario) => getPolicy(scenario.id)));
}

async function learn(run: SimulationRun, db: Db | null): Promise<void> {
  if (run.learned || !["contained", "breached"].includes(run.status)) return;
  if (!db) {
    const policy =
      store.policies.get(run.scenarioId) ?? baselinePolicy(run.scenarioId);
    store.policies.set(run.scenarioId, derivePolicy(run, policy));
    run.learned = true;
    return;
  }
  const collection = db.collection<PolicyDoc>("policies");
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await collection.findOne({ _id: run.scenarioId });
    const next = derivePolicy(run, previous ?? baselinePolicy(run.scenarioId));
    if (previous?.learnedFrom.includes(run.id)) {
      run.learned = true;
      return;
    }
    if (previous) {
      const result = await collection.replaceOne(
        { _id: run.scenarioId, version: previous.version },
        next,
      );
      if (result.modifiedCount) {
        run.learned = true;
        return;
      }
    } else {
      try {
        await collection.insertOne({ ...next, _id: run.scenarioId });
        run.learned = true;
        return;
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000
        ))
          throw error;
      }
    }
  }
  throw new StoreError(
    "The learned policy was being updated by another exercise. Please retry.",
    409,
  );
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
