# OPP-050: Hosted wiki backup (cloud backup for staging)

**Status:** Proposed — implement before ~25 active users.

## Summary

Back up the **wiki content only** from the hosted staging server to an encrypted, off-volume store. Email data is intentionally excluded — it is re-syncable from the user's mail server. This keeps the backup surface to plaintext Markdown, avoids exposing auth tokens or email content in backup storage, and eliminates the need for full-volume DO snapshots.

## Background: what happened and why

Full volume snapshots of `braintunnel-staging-storage` were **deleted on 2026-04-26** and automated snapshots are intentionally disabled. The reasoning:

A DO volume snapshot captures everything — email bodies, Google OAuth refresh tokens, vault session UUIDs, and LLM API keys — in plaintext. Any snapshot can be mounted on a new droplet by anyone with the DO account token. At ~15 users with a single operator, the complexity of managing snapshot hygiene and access control does not justify the backup coverage it provides, especially when most of the data on the volume does not actually need to be preserved.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the no-snapshot policy; this OPP is the implementable backup path.

## What needs backup — and what does not

### Back up: wiki content

`/brain-data/<tenant>/wiki/` — Markdown files generated and curated by the user over time. This is the **only truly irreplaceable data** per tenant. If lost, it cannot be reconstructed programmatically.

**Size:** small. Even a heavily used wiki is a few MB of Markdown. Backup is cheap.

### Do not back up: ripmail data

`/brain-data/<tenant>/ripmail/` — SQLite database, FTS index, `.eml` files, and IMAP state. This is a **re-downloadable cache** of the user's mail server. If lost, `ripmail sync` re-fetches from IMAP. The sync may take minutes for a large mailbox but no email is permanently lost.

**Excluding ripmail from backup also eliminates the biggest security liability:** email bodies and OAuth refresh tokens are the most sensitive data on the volume. A backup store that contains only Markdown is far less sensitive.

### Do not back up: vault sessions and tenant registry

`/brain-data/<tenant>/var/vault-sessions.json` and the tenant registry — these are small, low-sensitivity, and trivially regenerated on next login.

### Do not back up: `.env` and host secrets

These live on the droplet host, not the volume. They are managed separately in 1Password and should never be in a backup store.

## Threat model for backups

The risk a backup strategy must address:

| Scenario | Wiki backup helps? |
|---|---|
| Bug or agent error corrupts/deletes wiki | Yes |
| Accidental `rm -rf` on host volume | Yes |
| Droplet destroyed (DO incident, accidental delete) | Yes |
| Attacker who gains DO account access | **No** — they can access the backup store too; encryption of backup content helps |
| Ransomware on host | Partially — only if backup store is out-of-band |

## Recommended approach: encrypted tarball to DO Spaces

DO Spaces (S3-compatible object storage) in the same region as the droplet is the simplest operational fit — already inside the Braintunnel DO team, no new vendor to manage. The key difference from a volume snapshot is that the content is **encrypted before upload**, so the object store holds ciphertext, not plaintext Markdown.

```sh
# Conceptual nightly cron on the droplet
DATE=$(date -u +%Y%m%dT%H%M%SZ)
tar -czf - /brain-data/*/wiki/ \
  | age -r <operator-public-key> \
  > /tmp/wiki-backup-$DATE.tar.gz.age

# Upload to Spaces
s3cmd put /tmp/wiki-backup-$DATE.tar.gz.age \
  s3://braintunnel-backups/wiki/$DATE.tar.gz.age

rm /tmp/wiki-backup-$DATE.tar.gz.age
```

**Decryption key:** operator's `age` key pair, stored in 1Password. The private key never touches the droplet. Even if the Spaces bucket is compromised, the content is unreadable without the key.

**Retention:** keep 30 days of daily backups. At ~15 users with small wikis, this is a few hundred MB.

**Restore:**
```sh
# Download and decrypt
s3cmd get s3://braintunnel-backups/wiki/<date>.tar.gz.age - \
  | age -d -i <private-key> \
  | tar -xzf - -C /brain-data/
```

### Alternative: `restic` to Spaces

[restic](https://restic.net/) provides deduplicated, encrypted backups with built-in retention management. More operationally mature than a hand-rolled script; supports S3-compatible backends.

```sh
export RESTIC_REPOSITORY=s3:nyc3.digitaloceanspaces.com/braintunnel-backups
export AWS_ACCESS_KEY_ID=<spaces-key>
export AWS_SECRET_ACCESS_KEY=<spaces-secret>

restic backup /brain-data/*/wiki/
restic forget --keep-daily 30 --prune
```

The restic repo password (separate from the Spaces credentials) lives in 1Password. Spaces credentials can be a narrow Spaces-only token, not the DO master token.

This is the recommended approach once user count grows — better auditing, deduplication, and simpler retention policy.

### Alternative: private GitHub repository

For a developer-friendly workflow, the wiki directory can be treated as a git repository and pushed to a private GitHub repo nightly. No external tools needed; GitHub 2FA protects access; history is free.

Tradeoff: each tenant's wiki would need its own repo (or branch) to maintain isolation. Not practical beyond single-tenant or very small user count.

## Implementation sketch

1. **Create a DO Spaces bucket** `braintunnel-backups` (private, nyc1). Generate a Spaces-scoped access key (not the DO master token).
2. **Generate an `age` key pair** (`age-keygen`). Store private key in 1Password. Store public key in the cron script or an env var on the droplet.
3. **Add a cron job on the droplet** (or a one-shot script run via SSH from a management workflow) that tars wiki dirs, encrypts, and uploads.
4. **Test restore** before relying on it: download, decrypt, and verify a sample backup restores correctly to a temp directory.
5. **Add a runbook** in `docs/DEPLOYMENT.md` for restoring a tenant's wiki from backup.

## Relationship to other OPPs

- [OPP-034](OPP-034-wiki-snapshots-and-point-in-time-restore.md): local/desktop point-in-time restore (ZIP in `BRAIN_HOME`, triggered by Your Wiki laps). That is for user-facing "undo a bad agent edit." This OPP is operator-level hosted DR — different scope and trigger.
- [DEPLOYMENT.md](../DEPLOYMENT.md): no DO volume/droplet snapshots; wiki-only backup is the agreed DR path.
- [OPP-041 (archive)](archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md): the hosted staging infrastructure this backup runs against.
