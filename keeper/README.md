# Tribunal KeeperHub Workflows

Two workflows for operational glue:

## `ruling-execution.json`

Fires on every `VerdictLog.VerdictPosted` event. Looks up the case's escrow + prevailing party from `TribunalCore`, releases the escrow to the prevailing party, marks the case `Settled`, and posts a Discord notification.

Without this workflow, a verdict is on-chain but funds stay locked. KeeperHub turns the verdict into a finalised settlement automatically — exactly the "execution layer for onchain agents" pitch.

## `deadline-default.json`

Cron schedule (every 10 min). Scans every case; if any case has sat in `Filed` status for more than an hour without `acceptCase` being called, posts a Discord alert. Today this is just an alert; in production it could write a default judgment to the contract.

## Provisioning

Replace `{{ deployment.* }}` with the actual addresses from `docs/deployment.json` and register each workflow with KeeperHub per their CLI/UI instructions (https://docs.keeperhub.com/). Set `DISCORD_CHANNEL` in the workflow env.
