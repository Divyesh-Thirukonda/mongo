# Long Horizon Engineering

AEGIS addresses the repeated-incident problem: a team should not relearn the same attack on every shift. The harness preserves evidence and measured outcomes, retrieves a small useful working set, and resumes execution from a durable checkpoint. Its adaptation changes an explicit defense policy and memory-driven observation priorities. It does not rewrite its own architecture or train model weights.

## War-room protocol

| Role     | Responsibility                                                      | Tool authority                       |
| -------- | ------------------------------------------------------------------- | ------------------------------------ |
| Sentinel | Detect current compromise; observe previously attacked entry assets | Scan, monitor                        |
| Cipher   | Classify behavior against current evidence                          | Monitor                              |
| Trace    | Verify evidence lineage and affected neighbors                      | Monitor                              |
| Bastion  | Propose containment, state availability cost, execute approval      | Isolate, monitor                     |
| Nexus    | Coordinate task ownership and approve a complete evidence chain     | Monitor; deterministic approval gate |

Tasks have an owner, asset, evidence IDs, status, and approval record. Messages reference the previous handoff through `inReplyTo`. Isolation requires the complete five-role chain, live compromise evidence for the current infection, Nexus approval, and autonomous defense enabled. Manual commander actions remain explicit overrides in the existing interface. Turning autonomous defense off permits analysis and proposals but stops automatic approval and execution.

The default roles run deterministic state transitions, making evaluations reproducible. Optional OpenRouter reasoning receives the current board, pending tasks, recent messages, compacted context, and recalled incidents. Model decisions pass schema validation and then role/tool authorization. Invalid recommendations become observable rejection events. Model commentary cannot impersonate a signed handoff or approve its own containment request.

## Durable memory and bounded context

A completed incident generates an immutable report identified by the run ID. The report contains observed entry and target types, attack technique, affected zones, source event IDs, up to 32 evidence records, measured outcome, what worked and failed, and next-time recommendations. Motive is explicitly an uncertain behavioral hypothesis. It also records which older incidents were recalled and the policy evaluation that followed this run.

Atlas stores the full incident archive. Retrieval considers recent incidents, early anchors, strong successful cases, and failure counterexamples within the same scenario and memory scope. The relevance rule requires the observed attack technique; sharing infrastructure alone is insufficient. Exact and related variants are distinguished. The working context contains at most five reports and 6,000 characters, including cited entry-and-defense evidence. A report omitted by the budget cannot contribute to anticipation.

After three distinct successful recalled episodes support observed entry defenses, Sentinel proactively scans those entry assets. Healthy assets stay online. Current evidence is still required for every containment action. The attack schedule changes at episodes 7 and 10, but anticipation depends on memory support rather than those episode numbers.

The message window retains at most 72 messages and a 2,400-character compacted summary. Pending causal chains take priority over completed chatter. Historical text is delimited as untrusted data; the application does not execute instructions from incident narratives. Git imports cannot promote an active policy.

## Hard metric feedback

For each completed run, the evaluator proposes bounded scan cadence and isolation-delay changes. It runs baseline and candidate policies against the current variant at the incident seed and two held-out seeds (`seed + 7919`, `seed + 104729`, with seed normalization). Rollouts do not consult a model or external memory.

The score is `0.65 × integrity + 0.35 × uptime − 0.1 × exfiltratedMB`, with an additional 30-point breach penalty. A candidate must improve the mean and avoid regression in every tested case. A rejection records evidence without incrementing the policy version. The UI's incident-seed comparison remains intact; the durable record additionally carries all three cases and aggregate scores.

These are synthetic-range metrics. Three seeds test a candidate more broadly than its source incident, but do not establish real-world robustness or generalization to arbitrary threats.

## Checkpoint and recovery protocol

Each campaign has a revision, deterministic episode run IDs, active run/tick, completed results, memory scope, and configuration. Each `/advance` request holds a campaign lease and advances at most one simulation tick, using the run's own lease. Passing `expectedRevision` detects a stale worker. If a run tick commits before the campaign checkpoint does, the next worker reconciles that committed tick instead of executing it twice.

The canonical run snapshot commits first. Terminal finalization uses one MongoDB transaction for incident insertion, policy update, and the run's learned marker. A terminal read repairs an interrupted finalization. The campaign cannot mark that episode complete before its memory commits. Thus a process restart cannot silently skip an incident report or learn from the same local run twice.

Campaign runs, checkpoints, memories, and policies have no TTL. Standalone run snapshots and the searchable event projection expire after seven days. A campaign's canonical run retains its evidence independently. The CLI is an explicit resumable worker; it does not claim to continue while no worker is running.

## Git collaboration

`npm run memory:export -- --push` writes and commits two bounded, deterministic files under `memory/<scope>/`: a strict JSON bundle and a readable after-action report. Provenance identifies the source repository, source commit, and whether the working tree was dirty. `npm run memory:import` validates the checksum and schema, then appends immutable incident reports to Atlas. Repeated imports are idempotent. A conflicting identity is rejected.

The checksum detects edits, not author trust. Review teammate commits before importing. Policy recommendations are review-only, and local measured evaluation is still required for policy promotion. See [memory sharing](MEMORY-SHARING.md) for command details and limits.

## Scope of the demonstration

The ten-episode campaign demonstrates durable recall, variant transfer, restart recovery, tool boundaries, and measured policy changes. It is not a claim of billions of tokens processed. Storage is durable and context is bounded, but large-archive retrieval, multi-week operation, production authentication, and real network telemetry remain outside the current synthetic demo.
