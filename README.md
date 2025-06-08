<img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;"/>

# NetGet

> **Rete Adepto – Get it from the Net.**

**NetGet** is a modular **open-source network suite** designed to simplify the creation, management, and exposure of networks. It provides flexible tools for building efficient, decentralized, and adaptable systems.

---

## **Global Installation (System-wide CLI)**

Global installation sets up **NetGet** system-wide, providing access to its **Command Line Interface (CLI)** for configuring network routes and exposing services.

> **Compatible with Unix-based systems (Linux, macOS).**

**Installation:**

```bash
npm install -g netget
```

**Start NetGet Globally:**

```bash
netget
```

### 🔧 Features

- **Developer-friendly CLI** for live configuration of ports, routes, and domains.
- **HTTPS & SSL** management out of the box — no Nginx config needed.
- **Port & Traffic Management** with built-in diagnostics and conflict resolution.
- **Subdomain Routing & Wildcards** for modular growth and dApp-style integration.
- **Serve Static Content** from any folder with automatic HTTPS support.
- **Expose Internal Servers** securely via public domain and **port routing.**

------

<img src="https://suign.github.io/assets/imgs/netget-art.png" alt="netget" width="244px" style="display: block; margin: 0 auto;"/>

## **Architecture Overview**

**NetGet** is modular, with each component serving a specific purpose. Here's a quick overview:

- **Public Front**: Routes incoming traffic to your internal services.
- **Easy Domain Setup**: Use a main domain for NetGet and route subdomains through it.
- **Wildcard & SSL Management**: Automates HTTPS certificates, wildcard rules, and enforces secure traffic.

### Example Use Case

Suppose you own `example.com`, and you want to:

1. Route `https://example.com` to an API on port `5000`.
2. Point `api.example.com` to another service or static path.
3. Let NetGet manage SSL certificates for both automatically.

With **NetGet**, this entire setup can be done via a single interface — no manual configs or third-party tools needed.

------

## **Port Management**

NetGet includes a built-in **Port Management** module to help you monitor, inspect, and free up ports directly from the CLI.

**To access:**

```bash
netget
```

Navigate to **Port Management** using the arrow keys.

### Available Actions:

- **Inspect Port**: See which process is using a specific port, with PID and service info.
- **Kill Process on Port**: Free a blocked or stuck port by terminating the process.

Gain full visibility and control over your device’s port allocation and traffic routing.

------

## **Summary**

Whether you're a solo developer or managing infrastructure at scale, **NetGet** provides a unified way to expose local services, manage traffic, and build modular, decentralized architectures — with ease, flexibility, and security.

------

## By Neurons.me

### Contribution

Interested in collaborating or improving NetGet? We'd love your input.

### License & Policies

**License**: MIT (see LICENSE)

[https://www.neurons.me](https://www.neurons.me/)
 [Terms](https://docs.neurons.me/terms-and-conditions) | [Privacy](https://docs.neurons.me/privacy-policy)

<img src="https://docs.neurons.me/neurons.me.webp" alt="neurons.me logo" width="123" height="123">
