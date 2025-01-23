<img src="https://docs.neurons.me/media/netget.png" alt="netget" width="377px" style="display: block; margin: 0 auto;"/>

# NetGet

> **Rete Adepto – Get it from the Net.**

> **NetGet** is inspired by the idea of creating the **"right net"** – a network tailored to your needs. It empowers you to **get it from the net** and build efficient, decentralized, and versatile networks.

**NetGet** is a modular **open-source network creation suite** designed to simplify the creation, management, and exposure of networks. It provides flexible tools for building efficient, decentralized, and adaptable systems.

# Table of Contents
- [NetGet](#netget)
- [Table of Contents](#table-of-contents)
- [Getting Started:](#getting-started)
  - [1. **Global Installation (Device Scope)**](#1-global-installation-device-scope)
      - [Key Features:](#key-features)
  - [2. **Local Installation (Project Scope)**](#2-local-installation-project-scope)
      - [Key Features:](#key-features-1)
- [Understanding It's Parts](#understanding-its-parts)
  - [NetGetX](#netgetx)
      - [Accessing NetGetX via the CLI](#accessing-netgetx-via-the-cli)
      - [Example Use Case](#example-use-case)
  - [**Port Management**:](#port-management)
      - [Accessing Port Management](#accessing-port-management)
      - [**Available Actions**](#available-actions)
  - [**Summary**](#summary)
  - [By Neurons.me](#by-neuronsme)
      - [Contribution](#contribution)
      - [License \& Policies](#license--policies)

# Getting Started:
**NetGet** operates on **two levels** to suit different use cases:
## 1. **Global Installation (Device Scope)**
Global installation sets up **NetGet** at the device level, giving you access to its **Command Line Interface (CLI)** for managing network configurations and **exposing the device** to networks.

#### Key Features:
- **HTTPS Servers**: Create servers that listen on specific IPs and redirect traffic to internal processes.
- **Port Management**: Simplify port routing and allocations.
- **SSL Certificate Management**: Automate the handling of secure connections.

**Installation:**

```bash
npm install -g netget
```

**Start NetGet Globally:**

```bash
netget
```

------

## 2. **Local Installation (Project Scope)**
At the project level, **NetGet** offers tools and libraries that **integrate processes** into the **NetGet ecosystem**, enabling seamless interactions with the broader network.

#### Key Features:
- Install as a project dependency via npm.
- Import the library into your codebase for direct use.
- Simplify application connectivity to **NetGet** networks.

**Installation:**

```bash
npm install netget
```

**Usage:**

```js
import netget from 'netget';
```

# Understanding It's Parts
**NetGet** is modular, with each component serving a specific purpose. Here's a brief overview:

------

## NetGetX

<img src="https://docs.neurons.me/media/netgetX-readme.png" alt="netgetX" width="244px" align="right"/>

Simplifies traffic management by acting as a single entry point for all your services.

- **Public Front**: Routes incoming traffic to the right services.
- **Easy Setup**: Use one domain for **NetGetX** and point other domains and subdomains to it. Let **NetGetX** handle routing.
- **SSL & Subdomain Management**: Centrally manage certificates, subdomains, and wildcards.


#### Accessing NetGetX via the CLI
To use **NetGetX**, follow these steps:

1. **Start the CLI**
   Run the **NetGet** global command in your terminal:
   
   ```bash
   netget
   ```
   
2. **Select NetGetX**
   From the main menu, use the arrow keys to select **NetGetX**.

#### Example Use Case
Suppose you have the domain `example.com`, and you want to:

1. Route traffic from `https://example.com` to an internal API running on port `5000`.
2. Add a subdomain like `api.example.com` to point to another service or Static Path.
3. Automatically manage SSL certificates for both the domain and subdomain.

With **NetGetX**, you can achieve all of this from a single interface, eliminating the need for manual configurations or external tools.

----

<img src="https://docs.neurons.me/media/port_management_Netget.png" alt="netget Port Management" width="377" align="right">

## **Port Management**:
Port Management is a key feature of **NetGet's global installation**, providing tools to monitor and control ports on your device. It ensures that applications relying on specific ports run smoothly by helping you identify and resolve conflicts or issues with port usage.

#### Accessing Port Management
You can access Port Management through the **NetGet CLI.**

Run the following command in your terminal:
```bash
netget
```

 Use the arrow keys to navigate and select **Port Management** from the menu.

#### **Available Actions**

- **What's On Port?**
  This option lets you check which processes are using a specific port. Enter the port number when prompted, and NetGet will display detailed information about the process, such as its ID (PID), name, and status.
- **Kill Process On Port**
  This option helps you terminate a process occupying a specific port. This is especially useful when a port is blocked or stuck due to a lingering or misbehaving process.

With **Port Management**, you gain total control over port configurations and network traffic, simplifying monitoring and connections.

----

## **Summary**
NetGet works seamlessly at both the **device level**, managing networks and exposing processes globally, and at the **project level**, enabling individual applications to participate in the ecosystem. Whether you need to configure servers or integrate your app with the network, NetGet has you covered.

Whether you're an individual developer or managing enterprise-level networks, **NetGet** scales to meet your needs.

## By Neurons.me 
#### Contribution
If you are interested in collaborating or wish to share your insights, please feel free to reach out or contribute to the project.

#### License & Policies
- **License**: MIT License (see LICENSE for details).
- **Learn more** at **https://docs.neurons.me**
  [Terms](https://docs.neurons.me/terms-and-conditions) | [Privacy](https://docs.neurons.me/privacy-policy)
  
  <img src="https://docs.neurons.me/neurons.me.webp" alt="neurons.me logo" width="123" height="123">
