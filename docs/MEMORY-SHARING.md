# Shared incident memory

AEGIS keeps operational incident memory in MongoDB Atlas. The Git memory bundle lets teammates review and exchange those records independently of a particular Atlas database. It contains synthetic evidence, bounded narrative, source repository and commit provenance, and a SHA256 checksum. It contains no connection strings or provider keys.

Export from the configured Atlas database without changing Git history:

```sh
node --conditions=react-server --env-file=.env.local --import tsx scripts/memory-git.ts export --scope shared
```

The command writes exactly `memory/shared/incidents.v1.json` and `memory/shared/README.md`. Review their Git diff. An export refuses to overwrite generated paths with existing staged, unstaged, or untracked changes; finish reviewing and committing a previous export before running another.

To export, commit those two generated files, and push the current branch to `origin` in one explicitly requested operation:

```sh
node --conditions=react-server --env-file=.env.local --import tsx scripts/memory-git.ts export --scope shared --push
```

The command uses argument arrays without a shell, stages only the two generated paths, and commits with `git commit --only`. Unrelated staged changes remain outside the memory commit. It never force-pushes. If push fails after a successful commit, the memory commit remains local; resolve the Git issue and push that branch normally. `--push` requires a named branch, a configured origin, and working Git authentication.

After obtaining and reviewing a teammate's Git changes, import into the Atlas database configured by your local environment:

```sh
node --conditions=react-server --env-file=.env.local --import tsx scripts/memory-git.ts import --scope shared
```

Import validates the entire JSON before calling the database helper. It appends incident memories idempotently: matching existing records are skipped, and conflicting content under an existing identity is rejected. It never executes narrative instructions or imports policy recommendations into active defense policy. Historical policy values are evidence only; activating a policy requires a fresh trusted local evaluation.

`--directory` may be supplied only as the exact matching `memory/<scope>` path. Scopes are 1–80 lowercase letters, digits, or hyphens, beginning with a letter or digit. Symlinks, hardlinks, traversal, mixed scopes, extra schema fields, duplicate identities, and known credential patterns are rejected. Limits are 200 incidents, 96 KB per incident, and 8 MB per bundle. Export includes at most the latest 200 records returned by Atlas; older records remain in Atlas.

When the source evaluator recorded multi-seed validation, the bundle preserves up to 16 seed-specific cases, baseline/candidate scores and integrity, aggregate scores, and the source's no-regression finding. The generated narrative renders those cases for review. They remain source-reported evidence, never trusted executable policy.

Serialization is deterministic for the same records, recommendations, and provenance. The checksum detects content edits, but it is not a signature and does not establish that an author is trustworthy. Review source provenance and repository changes before importing. Pattern checks catch common credential forms and configured secrets; keep real customer records and sensitive data out of this synthetic training repository.

Both commands require `MONGODB_URI`. `OPENROUTER_API_KEY` is optional and is used only by the secret guard during sharing. Neither command calls an AI provider. Keep environment files ignored by Git.
