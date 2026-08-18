---
layout: readme
title: Signed Gateway Capabilities — netget
---

[← Back to netget Docs](https://neurons-me.github.io/netget/docs/)

---

# Signed Gateway Capabilities

## Concept Overview

Most gateways answer one question before letting a request act: **are you logged in, and are you
an admin?** If yes to both, the request can usually do anything the gateway exposes.

netget's gateway now answers a stricter, third question, kept separate from the first two:
**does this exact request carry a capability that was explicitly granted for this exact action?**

These are three different questions, and netget can now answer them independently:

- **Identity** — who this request claims to be, cryptographically anchored to a `.me` identity.
- **Signed proof** — that *this specific request* (this method, this path, this body, right now)
  was actually authorized by that identity — not just "logged in at some point."
- **Capability** — a specific, explicitly granted permission for one action. Never inferred from
  being logged in, and never inferred from being an admin.

## Why this matters

The usual failure mode in gateway/admin tooling is: *if you're an admin, you can do everything.*
That collapses three separate questions — who you are, whether this request is really you, and
what you're allowed to do — into one. One compromised or over-scoped admin session becomes total
control.

netget's gateway now keeps those three questions separate, and enforces all three on real
requests. A concrete example already running: an identity can be a verified, authenticated admin
— and still get rejected — because being admin was never the thing being checked. Only holding the
specific granted capability is.

## Status

This is live for one narrow, low-stakes action today: writing a domain's descriptive metadata
(`gateway:write:domain-metadata`). Not routing, not restart, not certificate provisioning — those
still run on the gateway's existing session-based auth, unchanged. Proven by a permanent,
automated test suite that runs against the real gateway, using real signed requests — not a design
sketch. It also has a real, thin UI client: an **Unlock .me Proof** control in netget's local admin
panel loads a signing identity into memory (never persisted) and lets that page attempt the same
signed write — with the server's actual decision, capability granted or not, always the one shown.

This is also the first operational piece of a broader model netget is built on top of: `.me`'s
theory of separating *encrypted audience* (who can decrypt/see a scope) from *capability* (what a
verified identity is explicitly permitted to change) — see
[The Algebra of Encrypted Audiences](https://suign.github.io/EncryptedAudiences.html). What's live
today proves the pattern works end to end on real infrastructure — extending it to more of the
gateway's control surface, and to real encrypted audience rather than today's plain claims list, is
future work.

## Implementation detail

- **[Gateway Capability Model](../Typescript/typedocs/GatewayCapabilityModel.html)** — the design
  decisions, `X-Me-Proof`, `me_sig.lua`, scopes, the daemon, the audit log.
- **[Signed Gateway Capability Tests](../Typescript/typedocs/EncryptedAudienceCapabilityTests.html)**
  — every test in the permanent suite, its exact setup and expectation, and how to run it.

## The theory behind it

- **[Digital Space Algebra](https://suign.github.io/DigitalSpaceAlgebra.html)** — the mathematical
  framework this is built on, from concept to implementation.
- **[The Algebra of Encrypted Audiences](https://suign.github.io/EncryptedAudiences.html)** — the
  specific `A`/`T`/`C` model this capability system implements a slice of.
- **[`.me`'s Algebra of Contexts](https://neurons-me.github.io/.me/Typescript/typedocs/Algebra-of-Contexts.html)**
  — the same model at the kernel-implementation level, where audience is already cryptographically
  real.

---

[← Back to netget Docs](https://neurons-me.github.io/netget/docs/)
