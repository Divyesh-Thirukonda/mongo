"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { createInitialRun } from "@/lib/simulation";
import type {
  DefensePolicy,
  Run,
  RunAction,
  RunResponse,
  ScenarioId,
  StorageStatus,
} from "@/lib/types";

export type WarRoomHealth = {
  database: { mode: string; connected: boolean; message?: string };
  ai: { configured: boolean; model: string };
};

export type WarRoomMemory = {
  policies: DefensePolicy[];
  storage: StorageStatus;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";

export function useWarRoom() {
  const [run, setRun] = useState<Run>(() =>
    createInitialRun("ransomware", 42, {
      id: "preview",
      createdAt: "2026-09-26T12:00:00.000Z",
    }),
  );
  const [scenarioId, setScenarioId] = useState<ScenarioId>("ransomware");
  const [paused, updatePaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<WarRoomHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [useLearnedPolicy, setUseLearnedPolicy] = useState(true);
  const [sound, setSound] = useState(false);
  const [history, setHistory] = useState<Run[]>([]);
  const [memory, setMemory] = useState<WarRoomMemory | null>(null);
  const [replayTick, updateReplayTick] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const runRef = useRef(run);
  const pausedRef = useRef(paused);
  const replayTickRef = useRef(replayTick);
  const soundRef = useRef(sound);
  const audioRef = useRef<AudioContext | null>(null);
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const visiblePendingRef = useRef(0);
  const historyPendingRef = useRef(0);
  const healthRequestRef = useRef(0);
  const historyRequestRef = useRef(0);
  const memoryRequestRef = useRef(0);

  const isPreview = run.id === "preview";
  const isRunning = run.status === "running" && !paused && replayTick === null;
  const isFinished = run.status === "contained" || run.status === "breached";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      void audioRef.current?.close().catch(() => {});
      audioRef.current = null;
    };
  }, []);

  const setPaused = useCallback((value: SetStateAction<boolean>) => {
    const next = typeof value === "function" ? value(pausedRef.current) : value;
    pausedRef.current = next;
    updatePaused(next);
  }, []);

  const setReplayTick = useCallback(
    (value: SetStateAction<number | null>) => {
      const requested =
        typeof value === "function" ? value(replayTickRef.current) : value;
      let next = requested;
      if (requested !== null) {
        const snapshots = runRef.current.snapshots;
        if (runRef.current.id === "preview" || !snapshots.length) return;
        const clamped = Math.max(0, Math.min(runRef.current.tick, requested));
        next = snapshots.reduce((nearest, snapshot) =>
          Math.abs(snapshot.tick - clamped) < Math.abs(nearest.tick - clamped)
            ? snapshot
            : nearest,
        ).tick;
        setPaused(true);
      }
      replayTickRef.current = next;
      updateReplayTick(next);
    },
    [setPaused],
  );

  const accept = useCallback((result: RunResponse) => {
    runRef.current = result.run;
    setRun(result.run);
    setStorage(result.storage);
    setError(null);
  }, []);

  const isCurrent = useCallback(
    (epoch: number, id?: string) =>
      mountedRef.current &&
      epochRef.current === epoch &&
      (id === undefined || runRef.current.id === id),
    [],
  );

  // Manual commands wait for an in-flight tick, so clicks cannot disappear or
  // overwrite a newer server revision. Automatic ticks never accumulate.
  const enqueue = useCallback(
    (operation: () => Promise<void>, visible = true): Promise<void> => {
      pendingRef.current += 1;
      if (visible) {
        visiblePendingRef.current += 1;
        setBusy(true);
      }
      const work = queueRef.current.then(operation);
      const completion = work.finally(() => {
        pendingRef.current -= 1;
        if (visible) {
          visiblePendingRef.current -= 1;
          if (mountedRef.current) setBusy(visiblePendingRef.current > 0);
        }
      });
      queueRef.current = completion.catch(() => {});
      return completion;
    },
    [],
  );

  const refreshHealth = useCallback(async () => {
    const request = ++healthRequestRef.current;
    try {
      const next = await api<WarRoomHealth>("/api/health");
      if (mountedRef.current && request === healthRequestRef.current) {
        setHealth(next);
        setHealthError(null);
      }
    } catch (failure) {
      if (mountedRef.current && request === healthRequestRef.current) {
        setHealth(null);
        setHealthError(message(failure));
      }
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const chirp = useCallback(() => {
    if (!soundRef.current) return;
    try {
      const ctx = audioRef.current;
      if (!ctx || ctx.state !== "running") return;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.setValueAtTime(520, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        780,
        ctx.currentTime + 0.09,
      );
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.15);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch {
      // Sound is optional; an unavailable audio device must not stop a run.
    }
  }, []);

  const advance = useCallback(
    async (epoch: number, id: string) => {
      if (!isCurrent(epoch, id) || runRef.current.status !== "running") return;
      const current = runRef.current;
      try {
        const result = await api<RunResponse>(`/api/runs/${id}/step`, {
          method: "POST",
          body: JSON.stringify({ expectedTick: current.tick }),
        });
        // Pause and speed changes do not invalidate a committed server tick.
        if (isCurrent(epoch, id)) {
          accept(result);
          chirp();
        }
      } catch (failure) {
        if (!isCurrent(epoch, id)) return;
        try {
          const latest = await api<RunResponse>(`/api/runs/${id}`);
          if (isCurrent(epoch, id)) accept(latest);
        } catch {
          // Preserve the original failure if recovery also fails.
        }
        if (isCurrent(epoch, id)) {
          setError(message(failure));
          setPaused(true);
        }
      }
    },
    [accept, chirp, isCurrent, setPaused],
  );

  useEffect(() => {
    if (!isRunning || isPreview) return;
    const timer = window.setInterval(
      () => {
        if (
          pendingRef.current ||
          pausedRef.current ||
          replayTickRef.current !== null ||
          runRef.current.status !== "running"
        )
          return;
        const epoch = epochRef.current;
        const id = runRef.current.id;
        void enqueue(async () => {
          if (!pausedRef.current && replayTickRef.current === null)
            await advance(epoch, id);
        }, false);
      },
      2200 / Math.max(0.25, speed),
    );
    return () => window.clearInterval(timer);
  }, [advance, enqueue, isPreview, isRunning, run.id, speed]);

  const launch = useCallback(
    (id = scenarioId, learnedPolicy = useLearnedPolicy) => {
      const epoch = ++epochRef.current;
      const autoDefend = runRef.current.autoDefend;
      setPaused(true);
      setError(null);
      return enqueue(async () => {
        if (!isCurrent(epoch)) return;
        try {
          const result = await api<RunResponse>("/api/runs", {
            method: "POST",
            body: JSON.stringify({
              scenarioId: id,
              seed: 42,
              autoDefend,
              aiEnabled,
              useLearnedPolicy: learnedPolicy,
            }),
          });
          if (!isCurrent(epoch)) return;
          accept(result);
          setScenarioId(result.run.scenarioId);
          setReplayTick(null);
          setSelectedNodeId(null);
          setSelectedAgentId(null);
          setPaused(false);
        } catch (failure) {
          if (isCurrent(epoch)) setError(message(failure));
        }
      });
    },
    [
      accept,
      aiEnabled,
      enqueue,
      isCurrent,
      scenarioId,
      setPaused,
      setReplayTick,
      useLearnedPolicy,
    ],
  );

  const action = useCallback(
    (type: RunAction["type"], nodeId?: string, enabled?: boolean) => {
      const current = runRef.current;
      if (replayTickRef.current !== null) {
        setError("Return to the current exercise before issuing a command.");
        return Promise.resolve();
      }
      if (current.id === "preview") {
        if (type === "auto-defend" && typeof enabled === "boolean") {
          const next = { ...current, autoDefend: enabled };
          runRef.current = next;
          setRun(next);
          setError(null);
        } else {
          setError("Launch an exercise before issuing a defense command.");
        }
        return Promise.resolve();
      }
      const epoch = epochRef.current;
      const id = current.id;
      return enqueue(async () => {
        if (!isCurrent(epoch, id)) return;
        try {
          const result = await api<RunResponse>(`/api/runs/${id}/action`, {
            method: "POST",
            body: JSON.stringify({ type, nodeId, enabled }),
          });
          if (isCurrent(epoch, id)) accept(result);
        } catch (failure) {
          if (isCurrent(epoch, id)) setError(message(failure));
        }
      });
    },
    [accept, enqueue, isCurrent],
  );

  const stepOnce = useCallback(() => {
    setPaused(true);
    const current = runRef.current;
    if (current.id === "preview" || current.status !== "running") {
      setError("Launch an active exercise before advancing its clock.");
      return Promise.resolve();
    }
    if (replayTickRef.current !== null) {
      setError("Return to the current exercise before advancing its clock.");
      return Promise.resolve();
    }
    const epoch = epochRef.current;
    return enqueue(() => advance(epoch, current.id));
  }, [advance, enqueue, setPaused]);

  const openRun = useCallback(
    (id: string) => {
      const epoch = ++epochRef.current;
      setPaused(true);
      setError(null);
      return enqueue(async () => {
        if (!isCurrent(epoch)) return;
        try {
          const result = await api<RunResponse>(`/api/runs/${id}`);
          if (!isCurrent(epoch)) return;
          accept(result);
          setScenarioId(result.run.scenarioId);
          setReplayTick(null);
          setSelectedNodeId(null);
          setSelectedAgentId(null);
          setPaused(true);
        } catch (failure) {
          if (isCurrent(epoch)) setError(message(failure));
        }
      });
    },
    [accept, enqueue, isCurrent, setPaused, setReplayTick],
  );

  const loadHistory = useCallback(async () => {
    const request = ++historyRequestRef.current;
    historyPendingRef.current += 1;
    setHistoryLoading(true);
    try {
      const body = await api<{ runs: Run[] }>("/api/runs");
      if (mountedRef.current && request === historyRequestRef.current)
        setHistory(body.runs || []);
    } catch (failure) {
      if (mountedRef.current && request === historyRequestRef.current)
        setError(message(failure));
    } finally {
      historyPendingRef.current -= 1;
      if (mountedRef.current) setHistoryLoading(historyPendingRef.current > 0);
    }
  }, []);

  const loadMemory = useCallback(async () => {
    const request = ++memoryRequestRef.current;
    historyPendingRef.current += 1;
    setHistoryLoading(true);
    try {
      const body = await api<WarRoomMemory>("/api/memory");
      if (mountedRef.current && request === memoryRequestRef.current)
        setMemory(body);
    } catch (failure) {
      if (mountedRef.current && request === memoryRequestRef.current)
        setError(message(failure));
    } finally {
      historyPendingRef.current -= 1;
      if (mountedRef.current) setHistoryLoading(historyPendingRef.current > 0);
    }
  }, []);

  const reset = useCallback(() => {
    epochRef.current += 1;
    setPaused(true);
    const preview = createInitialRun(scenarioId, 42, {
      id: "preview",
      createdAt: "2026-09-26T12:00:00.000Z",
      autoDefend: runRef.current.autoDefend,
    });
    runRef.current = preview;
    setRun(preview);
    setStorage(null);
    setSelectedNodeId(null);
    setSelectedAgentId(null);
    setReplayTick(null);
    setError(null);
  }, [scenarioId, setPaused, setReplayTick]);

  const replayAt = useCallback(
    (tick: number) => setReplayTick(tick),
    [setReplayTick],
  );
  const exitReplay = useCallback(() => setReplayTick(null), [setReplayTick]);
  const pauseResume = useCallback(() => {
    if (
      runRef.current.id === "preview" ||
      runRef.current.status !== "running"
    ) {
      void launch();
      return;
    }
    if (replayTickRef.current !== null) {
      setReplayTick(null);
      setPaused(false);
    } else {
      setPaused((value) => !value);
    }
  }, [launch, setPaused, setReplayTick]);

  const exportRun = useCallback(() => {
    const current = runRef.current;
    const blob = new Blob([JSON.stringify(current, null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `aegis-${current.scenarioId}-${current.id.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundRef.current;
    if (next) {
      try {
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume().catch(() => {
          soundRef.current = false;
          if (mountedRef.current) setSound(false);
        });
      } catch {
        setError("Event audio is unavailable in this browser.");
        return;
      }
    }
    soundRef.current = next;
    setSound(next);
  }, []);

  const snapshot =
    replayTick !== null
      ? run.snapshots.find((item) => item.tick === replayTick)
      : null;
  const nodes = snapshot?.nodes ?? run.nodes;
  const metrics = snapshot?.metrics ?? run.metrics;
  const shownTick = replayTick ?? run.tick;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedAgentData = run.agents.find(
    (agent) => agent.id === selectedAgentId,
  );
  const filteredEvents = run.events
    .filter(
      (event) =>
        (!selectedAgentId || event.agentId === selectedAgentId) &&
        (replayTick === null || event.tick <= replayTick),
    )
    .slice(-18)
    .reverse();
  const atlasConnected =
    health?.database.connected === true && health.database.mode === "atlas";

  return {
    run,
    isPreview,
    preview: isPreview,
    isRunning,
    running: isRunning,
    isFinished,
    finished: isFinished,
    paused,
    setPaused,
    speed,
    setSpeed,
    scenarioId,
    setScenarioId,
    selectedNodeId,
    setSelectedNodeId,
    selectedAgentId,
    setSelectedAgentId,
    busy,
    error,
    setError,
    health,
    healthError,
    storage,
    aiEnabled,
    setAiEnabled,
    useLearnedPolicy,
    setUseLearnedPolicy,
    sound,
    toggleSound,
    history,
    memory,
    historyLoading,
    replayTick,
    setReplayTick,
    nodes,
    metrics,
    shownTick,
    filteredEvents,
    selectedNode,
    selectedAgentData,
    atlasConnected,
    launch,
    action,
    pauseResume,
    reset,
    exportRun,
    openRun,
    loadHistory,
    loadMemory,
    stepOnce,
    replayAt,
    exitReplay,
    refreshHealth,
  };
}
