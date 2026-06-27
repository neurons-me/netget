---
layout: readme
title: Multi-Domain Architecture — netget
---

[← Back to netget Docs](https://neurons-me.github.io/netget/docs/)

---

# Multi-Domain Deployment with Shared Sources using Netget

## Concept Overview

In modern modular web deployments, a **single codebase** often needs to serve **multiple domains**. For example:

- `mexicoencuesta.mx`
- `mexicoencuesta.com`
- `méxicoencuesta.com`

While each of these domains may have its own DNS, SSL certificate, or cookie scope, they can all **share the same frontend/backend code**. This is where Netget's modular structure comes in.

---

## Folder Structure

We use two main directories:

```
shared/
└── mexicoencuesta/
├── dist/     # Build output (frontend or backend)
├── src/      # Source code (optional)
└── config/    # Optional per-domain config files
domains/
├── mexicoencuesta.mx/
├── mexicoencuesta.com/
└── méxicoencuesta.com/
```

Each folder in `domains/` can point to a shared codebase defined in `shared/`.

---

## netget.json Example

Each domain can have its own `netget.json`, like this:

```json
{
  "target": "../../shared/mexicoencuesta/dist"
}
```

This keeps the deployment **clean**, **consistent**, and **easy to maintain**.

------

## **Optional: Domain-specific Configuration**

To allow per-domain customization (e.g., branding or localization), you can include:

```
shared/mexicoencuesta/config/mexicoencuesta.mx.json
shared/mexicoencuesta/config/mexicoencuesta.com.json
```

Your app can then detect the hostname and load the appropriate config.

------

## **Rules of Thumb**

| **Case**                         | **Best Practice**            |
| -------------------------------- | ---------------------------- |
| One codebase, many domains       | Use shared/                  |
| Each domain needs its own config | Add config/ inside shared/   |
| One domain, one unique source    | Use domains/domain.tld/ only |

------

## **Benefits**

- DRY (Don’t Repeat Yourself)
- Easy to test and deploy across environments
- Centralized updates and bug fixes
- Clean distinction between **source** and **deployment**

------

## **Example Use Case**

You have a survey platform:

- Single app code in shared/mexicoencuesta
- Three domain targets pointing to it via domains/
- Domain-specific config loaded at runtime

------

Start thinking in **domains as entry points**, and **sources as reusable building blocks**.

---

[← Back to netget Docs](https://neurons-me.github.io/netget/docs/)
