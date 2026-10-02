# ASTRA V5 Institutional Decision Layer — Research Sidecar

This directory is an isolated research layer. It is **not** imported by the ASTRA V4 production APIs, dashboard, recommendation engine, UCP selection path, or Vercel production deployment.

## Objective

Convert the research decision process from a threshold-only engine into a governed institutional-style decision layer:

```text
Verified ASTRA/UCP opportunity row
  -> Prospective-only probability model
  -> Isotonic calibration
  -> Break-even probability
  -> Expected Value after costs + slippage
  -> Uncertainty / OOD gate
  -> RESEARCH_CANDIDATE or NO_TRADE
```

The layer is allowed to abstain. A missing, uncalibrated, weak, out-of-distribution, low-quality, low-liquidity or negative-EV setup returns **NO_TRADE**.

## Isolation guarantees

- Branch: `research/astra-v5-institutional-decision-layer`
- No changes to `main`
- No production API route added or changed
- No dashboard/UI change
- No V4 recommendation-selection change
- No automatic champion promotion
- No trading/execution permission
- No production-data writes
- V5 reads the current ASTRA/UCP board only when the shadow runner is invoked manually

Every V5 result carries:

```json
{
  "researchOnly": true,
  "usedForCurrentAppSelection": false,
  "executionAllowed": false
}
```

## Calibration policy

A V5 probability is not considered publishable until the **prospective-only** dataset satisfies all default gates:

- >= 90 resolved prospective trades
- >= 60 forward sessions
- >= 120 observed calendar days
- >= 25 positive outcomes
- >= 25 negative outcomes
- zero critical governance breaches
- untouched chronological validation ECE <= 0.10
- Brier Skill Score >= 0 versus the train-period base-rate model

Backtest/retrospective rows do not count toward calibration readiness.

## Chronological modelling

`prospective-calibration.js` uses a strict chronological split:

- first 60%: train a regularized logistic model
- next 20%: fit isotonic calibration with PAV
- final 20%: untouched validation for Brier score, Brier Skill Score and ECE

Normalization is learned from the train segment only.

## Decision gates

After calibration readiness is proven, a row must also pass:

- valid entry / stop / target plan
- data quality >= 60
- liquidity >= 50
- morning state not rejected
- uncertainty <= 55
- calibrated probability edge >= 3 percentage points above break-even
- expected value >= +0.25% after round-trip costs and estimated slippage

These thresholds are research defaults, not live trading instructions.

## Expected Value

The decision layer calculates EV after friction:

```text
EV = p(target) * net_reward - (1 - p(target)) * net_loss
```

Default friction assumptions:

- round-trip cost: 0.60%
- slippage allowance: 0.15%

If a row carries explicit values they override the defaults.

## Uncertainty

The uncertainty score combines:

- prospective sample size
- validation calibration error
- out-of-distribution feature distance
- predictive entropy
- missing-feature rate

High uncertainty forces `NO_TRADE_UNCERTAINTY`.

## Files

- `institutional-decision-engine.js` — probability/EV/uncertainty/abstention decision layer
- `prospective-calibration.js` — prospective-only chronological model trainer and calibrator
- `model.json` — fail-closed bootstrap model; starts NOT_CALIBRATED
- `shadow-runner.js` — read-only adapter to current ASTRA/UCP data
- `validation.js` — deterministic safety and modelling validation

## Manual validation

From the repository root:

```bash
node research/astra-v5/validation.js
```

Read-only current-data shadow run:

```bash
node research/astra-v5/shadow-runner.js
```

With the bootstrap model, the expected behavior is intentionally:

```text
Probability: null
Expected Value: null
Decision: NO_TRADE_UNCALIBRATED
Execution: false
```

That behavior is a safety feature, not an error.
