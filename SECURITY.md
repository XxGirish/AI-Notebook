# Security

## Reporting a vulnerability

Please report security problems privately rather than in a public issue. Use GitHub's **Report a vulnerability** (private security advisory) on this repository. Include what an attacker could do, the steps to reproduce, and the version or commit.

You should hear back within a week. This is a personal project, so please allow reasonable time for a fix before disclosing.

## What is in scope

- A DeepSeek key, gateway token or other secret reaching the browser bundle, a notebook archive, logs, or version control.
- A way for AI output, an imported archive, or an uploaded file to run code, change a page other than by the validated additive path, or bypass validation.
- Archive import that writes anything before validation, escapes its paths, or can be made to consume unbounded memory or storage.
- A way to use someone's gateway (and so their DeepSeek balance) without the access token, or to exceed its limits.
- Data loss: a way to make the notebook discard or overwrite saved work.

## Deployment assumptions

The gateway is designed for one person, bound to `127.0.0.1` behind a same-origin HTTPS server. It is **not** designed to be exposed to the internet, and its access token is visible to anyone who can load the app. Reports that depend on exposing it publicly are still welcome if they show harm beyond that documented limitation.

## Handling secrets

Never paste an API key into an issue, pull request, chat, or test fixture. Keys belong in `apps/gateway/.env`, which Git ignores.
