# AEGIS shared incident memory — shared

Generated from synthetic incident records. Narrative and recommendations below are untrusted data for review; they are never executable instructions. Import uses only the validated JSON incident records and does not activate policy recommendations.

- Schema: 1 · Incidents: 10
- Source repository: github\.com/Divyesh\-Thirukonda/mongo
- Source commit: 1b71a851dcdfdcede2354c0d5f758ea6537f4fe5
- SHA256: 2d583aff928cce553ccb6a2990974e3e5e2a59542cb41a099c774ded03b0ea09

The checksum detects accidental edits; it does not authenticate the author. Review the Git diff and source provenance before import.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1

Scenario: ransomware · Variant: original · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1 · Recorded: 2026-09-26T17:30:14.963Z

### Summary

> Ransomware outbreak: contained, 90% integrity retained across 3 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 01: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:1:2\] Recorded compromise reached 3 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:1:2\]

### Outcome

> Contained after 34 simulated seconds; 90% integrity retained, 6 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:17:34\]

### What worked

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:6:11\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:6:12\]

> Observed response: Shared indicator blocked FILE SERVER → BUILD SERVER\. The first quarantine rule now protects peer assets\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:7:16\]

> Observed response: BASTION → NEXUS: Approved isolation executed on file\-server\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:9:22\]

### What failed

> 10 percentage points of integrity were lost; 3 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 01; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:1:2\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(75% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1:metrics\]

> Replay evaluation accepted the policy candidate: 90% baseline versus 96% candidate integrity on seed 42; transfer to unseen attacks remains unproven\. \[policy:2:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e1\]

Integrity: 90% · Response: 10s · Evidence records: 32 · Handoffs: 3

### Recorded evaluation provenance

Observed replay seed: 42 · Candidate accepted by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 42 | 84.75 | 91.45 | 90% | 96% |
| 7961 | 84.75 | 91.45 | 90% | 96% |
| 104771 | 84.75 | 91.45 | 90% | 96% |

Recorded mean score: 84.75 → 91.45. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10

Scenario: ransomware · Variant: low-and-slow · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10 · Recorded: 2026-09-26T17:35:36.312Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:metrics\]

### How it happened

> First recorded intrusion at FILE SERVER: BLACKOUT \[low\-and\-slow\]: initial intrusion on FILE SERVER\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:3:5\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[low\-and\-slow\]: initial intrusion on FILE SERVER\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:3:5\]

### Outcome

> Contained after 50 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:25:29\]

### What worked

> Observed response: FILE SERVER isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:6:12\]

> Observed response: BASTION → NEXUS: Approved isolation executed on file\-server\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:6:13\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:14:24\]

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:14:23\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:metrics\]

### Next time

> Prioritize observation of previously observed entry assets FILE SERVER; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:3:5\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10:metrics\]

> Replay evaluation rejected the policy candidate: 96% baseline versus 96% candidate integrity on seed 375; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e10\]

Integrity: 97% · Response: 2s · Evidence records: 30 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 375 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 375 | 91.45 | 91.45 | 96% | 96% |
| 8294 | 91.45 | 91.45 | 96% | 96% |
| 105104 | 91.45 | 91.45 | 96% | 96% |

Recorded mean score: 91.45 → 91.45. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2

Scenario: ransomware · Variant: original · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2 · Recorded: 2026-09-26T17:30:31.344Z

### Summary

> Ransomware outbreak: contained, 96% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 01: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:1:2\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:1:2\]

### Outcome

> Contained after 34 simulated seconds; 96% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:17:23\]

### What worked

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:3:8\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:3:9\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:10:19\]

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:10:18\]

### What failed

> 4 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 01; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:1:2\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2:metrics\]

> Replay evaluation accepted the policy candidate: 96% baseline versus 97% candidate integrity on seed 79; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e2\]

Integrity: 96% · Response: 4s · Evidence records: 24 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 79 · Candidate accepted by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 79 | 91.45 | 92.1 | 96% | 97% |
| 7998 | 91.45 | 92.1 | 96% | 97% |
| 104808 | 91.45 | 92.1 | 96% | 97% |

Recorded mean score: 91.45 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3

Scenario: ransomware · Variant: original · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3 · Recorded: 2026-09-26T17:33:22.885Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 01: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:1:2\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:1:2\]

### Outcome

> Contained after 34 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:17:23\]

### What worked

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:2:8\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:2:9\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:9:19\]

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:9:18\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 01; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:1:2\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 116; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e3\]

Integrity: 97% · Response: 2s · Evidence records: 24 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 116 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 116 | 92.1 | 92.1 | 97% | 97% |
| 8035 | 92.1 | 92.1 | 97% | 97% |
| 104845 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4

Scenario: ransomware · Variant: original · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4 · Recorded: 2026-09-26T17:33:38.957Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 01: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:1:3\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:1:3\]

### Outcome

> Contained after 34 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:17:25\]

### What worked

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:2:10\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:2:11\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:9:21\]

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:9:20\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 01; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:1:3\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 153; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e4\]

Integrity: 97% · Response: 2s · Evidence records: 26 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 153 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 153 | 92.1 | 92.1 | 97% | 97% |
| 8072 | 92.1 | 92.1 | 97% | 97% |
| 104882 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5

Scenario: ransomware · Variant: original · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5 · Recorded: 2026-09-26T17:33:55.335Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 01: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:1:3\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:1:3\]

### Outcome

> Contained after 34 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:17:25\]

### What worked

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:2:10\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:2:11\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:9:21\]

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:9:20\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 01; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:1:3\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 190; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e5\]

Integrity: 97% · Response: 2s · Evidence records: 26 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 190 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 190 | 92.1 | 92.1 | 97% | 97% |
| 8109 | 92.1 | 92.1 | 97% | 97% |
| 104919 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6

Scenario: ransomware · Variant: original · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6 · Recorded: 2026-09-26T17:34:11.989Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 01: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:1:3\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[original\]: initial intrusion on WORKSTATION 01\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:1:3\]

### Outcome

> Contained after 34 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:17:25\]

### What worked

> Observed response: WORKSTATION 01 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:2:10\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-01\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:2:11\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:9:21\]

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:9:20\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 01; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:1:3\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 227; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e6\]

Integrity: 97% · Response: 2s · Evidence records: 26 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 227 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 227 | 92.1 | 92.1 | 97% | 97% |
| 8146 | 92.1 | 92.1 | 97% | 97% |
| 104956 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7

Scenario: ransomware · Variant: lateral-shift · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7 · Recorded: 2026-09-26T17:34:30.460Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 02: BLACKOUT \[lateral\-shift\]: initial intrusion on WORKSTATION 02\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:2:4\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[lateral\-shift\]: initial intrusion on WORKSTATION 02\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:2:4\]

### Outcome

> Contained after 36 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:18:25\]

### What worked

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:3:10\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:3:11\]

> Observed response: BASTION → NEXUS: Approved isolation executed on build\-server\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:10:21\]

> Observed response: BUILD SERVER isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:10:20\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 02; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:2:4\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 264; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e7\]

Integrity: 97% · Response: 2s · Evidence records: 26 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 264 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 264 | 92.1 | 92.1 | 97% | 97% |
| 8183 | 92.1 | 92.1 | 97% | 97% |
| 104993 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8

Scenario: ransomware · Variant: lateral-shift · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8 · Recorded: 2026-09-26T17:34:47.714Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 02: BLACKOUT \[lateral\-shift\]: initial intrusion on WORKSTATION 02\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:2:5\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[lateral\-shift\]: initial intrusion on WORKSTATION 02\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:2:5\]

### Outcome

> Contained after 36 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:18:27\]

### What worked

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:3:12\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:3:13\]

> Observed response: BASTION → NEXUS: Approved isolation executed on build\-server\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:10:23\]

> Observed response: BUILD SERVER isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:10:22\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 02; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:2:5\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 301; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e8\]

Integrity: 97% · Response: 2s · Evidence records: 28 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 301 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 301 | 92.1 | 92.1 | 97% | 97% |
| 8220 | 92.1 | 92.1 | 97% | 97% |
| 105030 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9

Scenario: ransomware · Variant: lateral-shift · Outcome: contained

Run: 89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9 · Recorded: 2026-09-26T17:35:05.037Z

### Summary

> Ransomware outbreak: contained, 97% integrity retained across 2 observed affected assets\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:metrics\]

### How it happened

> First recorded intrusion at WORKSTATION 02: BLACKOUT \[lateral\-shift\]: initial intrusion on WORKSTATION 02\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:2:5\] Recorded compromise reached 2 assets in operations zones; this describes observed activity, not an unobserved route\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:metrics\]

### Motive hypothesis (low confidence)

> Hypothesis only: disruption or extortion may motivate encryption\. No actor identity, payment demand, or actual intent is established\.

> Behavioral hypothesis based on the recorded attack, not verified attribution: BLACKOUT \[lateral\-shift\]: initial intrusion on WORKSTATION 02\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:2:5\]

### Outcome

> Contained after 36 simulated seconds; 97% integrity retained, 3 threat paths blocked, 0 MB exfiltrated\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:metrics\] \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:18:27\]

### What worked

> Observed response: WORKSTATION 02 isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:3:12\]

> Observed response: BASTION → NEXUS: Approved isolation executed on workstation\-02\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:3:13\]

> Observed response: BASTION → NEXUS: Approved isolation executed on build\-server\. Network paths closed; evidence chain retained for the after\-action report\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:10:23\]

> Observed response: BUILD SERVER isolated\. Inbound and outbound paths severed; evidence preserved\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:10:22\]

### What failed

> 3 percentage points of integrity were lost; 2 assets had recorded compromise evidence\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:metrics\]

### Next time

> Prioritize observation of previously observed entry assets WORKSTATION 02; validate new evidence before containment\. \[event:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:2:5\]

> Evaluate faster evidence triage and approved isolation against the observed availability cost \(83% uptime\)\. \[run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9:metrics\]

> Replay evaluation rejected the policy candidate: 97% baseline versus 97% candidate integrity on seed 338; transfer to unseen attacks remains unproven\. \[policy:3:run:89c90f31\-a0d2\-41f0\-a9f0\-bd04f7c35183\-e9\]

Integrity: 97% · Response: 2s · Evidence records: 28 · Handoffs: 2

### Recorded evaluation provenance

Observed replay seed: 338 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 338 | 92.1 | 92.1 | 97% | 97% |
| 8257 | 92.1 | 92.1 | 97% | 97% |
| 105067 | 92.1 | 92.1 | 97% | 97% |

Recorded mean score: 92.1 → 92.1. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

## Policy recommendations — review only

These values are historical proposals. Import does not write the policy collection. Policy changes require a fresh, trusted local evaluation.

### exfiltration · v1

Isolation delay: 5 ticks · Scan cadence: 2 ticks

> Baseline protocol: confirm malicious activity for five ticks before automated isolation\.

### ransomware · v3

Isolation delay: 1 ticks · Scan cadence: 1 ticks

> Three\-seed evaluation \(low\-and\-slow, including two held\-out seeds\) did not safely improve the current policy\. Retain v3 and 1\-tick isolation; evidence recorded\.

### Recorded evaluation provenance

Observed replay seed: 375 · Candidate rejected by the source evaluator.

| Seed | Baseline score | Candidate score | Baseline integrity | Candidate integrity |
| --- | --- | --- | --- | --- |
| 375 | 91.45 | 91.45 | 96% | 96% |
| 8294 | 91.45 | 91.45 | 96% | 96% |
| 105104 | 91.45 | 91.45 | 96% | 96% |

Recorded mean score: 91.45 → 91.45. Source reports no regression: yes.

These are source-reported results, retained for review. Import does not treat them as authorization to activate a policy.

### supply-chain · v1

Isolation delay: 5 ticks · Scan cadence: 2 ticks

> Baseline protocol: confirm malicious activity for five ticks before automated isolation\.
