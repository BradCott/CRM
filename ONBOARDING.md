# Knox CRM — Developer Onboarding

The Knox CRM/management app. React + Vite frontend, Express + SQLite (`node:sqlite`)
backend. Hosted on Railway at **https://crm.knoxcre.com**.

> **How deploys work:** pushing to the `main` branch auto-deploys to production in
> ~2 minutes. There is no separate staging site — `main` **is** live. Test your
> change locally before you push.

## 1. Prerequisites

- **Node.js 22+** (`node -v` to check)
- **Git** (Git for Windows includes the Bash shell the hooks need)
- **Claude Code** signed in with **your own** Claude account (Pro/Max or API billing).
  Don't use anyone else's login.
- Access to the **`BradCott/CRM`** GitHub repo (ask Brad to add you as a collaborator).

## 2. First-time setup

```bash
git clone https://github.com/BradCott/CRM.git
cd CRM
npm install          # also installs the pre-push safety check (see §5)
```

Create a **`.env`** file in the project root. The server won't boot without it.
Start minimal — ask Brad for any keys you actually need:

```
JWT_SECRET=any-long-random-string-for-local-dev
# Optional — only needed to test these features locally (get from Brad if required):
# ANTHROPIC_API_KEY=...      # AI copilot, document parsing, categorization
# HANDWRYTTEN_API_KEY=...    # mail campaigns
```

**Do not put production secrets on your machine.** You don't need them to build the
app — only to exercise a specific integration locally, and even then use test keys.

To work with realistic data, ask Brad for a **backup `.db` file** and drop it at
`data/crm.db`. A fresh clone starts with an empty database.

## 3. Run it locally

```bash
npm run dev          # starts the client (Vite) + server together
```

Open the URL Vite prints (usually http://localhost:5173).

## 4. Make a change → ship it

```bash
git checkout main && git pull       # start from latest
# ... make your changes with Claude Code ...
npm run check                       # build + syntax check (optional; runs on push anyway)
git add -A
git commit -m "Short description of what changed"
git push                            # runs the checks, then deploys to production
```

- Keep commits focused and describe **what changed** in the message.
- End commit messages that Claude Code writes with the co-author trailer it uses.

## 5. The pre-push safety check

On `git push`, the repo automatically runs `npm run check` (frontend build + server
syntax check). **If the app doesn't build, the push is blocked** — so a broken change
can't reach production. Fix the errors and push again.

Emergency bypass (only if you're certain): `git push --no-verify`.

## 6. If something breaks in production — roll back

Two ways, both fast:

- **Railway dashboard (fastest):** open the CRM service → **Deployments** →
  find the last good deploy → **Redeploy**. Live again in ~30 seconds.
- **Git:** `git revert <bad-commit-sha>` then `git push`. This makes a new commit
  that undoes the bad one and redeploys cleanly.

## 7. Your data is safe from code changes

- **Code and data are separate.** The database lives on a Railway **persistent
  volume**, so deploying new code never touches your records. (If you ever spin up
  new infrastructure, make sure that volume stays mounted at the `data/` directory.)
- **Automated backups** run daily at 3:30 AM and keep the last 14 snapshots
  (`data/backups/`). You can also download an on-demand backup any time from the
  admin backup endpoint. A bad migration or accidental delete is recoverable by
  restoring a snapshot.

## 8. Working alongside others

- If two people edit the same files, use short-lived branches + pull requests to
  avoid clobbering each other. For independent areas, pushing to `main` is fine.
- Pull (`git pull`) before you start and before you push.

## Quick reference

| Task | Command |
|---|---|
| Install (+ hooks) | `npm install` |
| Run locally | `npm run dev` |
| Build + checks | `npm run check` |
| Ship to production | `git push` (on `main`) |
| Roll back | Railway → Deployments → Redeploy, or `git revert` |
