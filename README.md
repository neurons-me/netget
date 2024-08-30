<img src="https://suign.github.io/assets/imgs/netget.png" alt="netget" width="420" align="right">

# NetGet

> [netget.me](https://netget.me)


## Install:

Install **NetGet** globally using npm:

```bash
npm install -g netget
```

## Start:

Once installed, start the **NetGet** by simply running the following command in the terminal:

```bash
netget
```

---------------

# Modules:

## **NetGetX**

Serves as a **front face to the public.** Provides an efficient, centralized solution for managing and directing public traffic to the correct internal services.
Is particularly useful in environments where multiple services or applications must be accessible through a single entry point. 
<img src="https://suign.github.io/assets/imgs/netgetX.png" alt="netgetX" width="377">

- **Public Interface**: Serves as the front face to the public by acting as a reverse proxy that redirects all traffic to a specific port.

- **Optimal NGINX Configuration**: Ensures that NGINX is set up as a robust and efficient channel, directing incoming traffic to the appropriate internal endpoints automatically.

- **Reverse Proxy Setup**: Ideal for environments where multiple services or applications need to be accessible through a single entry point. This setup simplifies traffic management by centralizing the routing process.

  **For example:** Rather than having different domain names, server names, and configurations for each website or application, you **set up NetGetX on a specific domain**. Once configured, you **point all your other domains to this NetGetX domain.** This approach eliminates the need to maintain multiple **DNS records**, as they all redirect to the same place. **NetGetX** handles the traffic and routes it to the appropriate internal services based on your configurations.  
  In summary, **NetGetX** provides an efficient, centralized solution for managing and directing public traffic to the correct internal services, **simplifying domain and server management.**

---

## GateWays:

A **Gateway** in NetGet is a key component that manages incoming traffic in a more granular level.
Here are the key points about its functionality:

<img src="https://suign.github.io/assets/imgs/netgetGateways.png" alt="netgetX" width="377">

- **Traffic Reception**: Gateways receive traffic through an input port. Typically plugged in after a **NetGetX** to handle all public requests.
- **Request Management**: The gateway identifies the requester, domain, subdomain, or path of the incoming request.
- **Route Handling**: Based on predefined routes, the gateway determines how to handle each request.
- **Redirection**: The gateway can redirect requests to another port where a different server is active.
- **Request Handling**: Alternatively, it can process the request directly using specified handlers.
  In essence, a **Gateway** acts as a **traffic manager**, directing and processing incoming requests **based on defined rules and routes.**

----

## **Port Management**:

"I traced the *cord back to the wall*, *no wonder* it was ever plugged in at all ... ♪ ♪ ♪
<img src="https://suign.github.io/assets/imgs/port_management.png" alt="netgetX" width="377">

- **Check Port Activity**: Users can check what processes are running on a specific port.
- **Kill Processes**: Facilitates the termination of processes running on a selected port by converting port numbers to PIDs.
  **In summary**, the **Port Management** menu offers comprehensive control over port configurations and process management, streamlining the process of monitoring and managing network traffic and making the right connections easy.

------

**Local NetGet Setup:** On your local machine, **NetGet** operates within your Node.js environment, managing local traffic and processing requests according to your configured rules. The GateWays doesn't directly face the internet and instead communicates with an external **NetGetX** instance that does or any other service.



# Install as a Node Module Dependency.

```bash
npm install netget
```

### GateWay SetUp

```js
// NETGET
import NetGet from 'netget';
import { routes } from './GET/routes.js';
let netget = new NetGet();
netget.Gateway({ routes: routes }).listen();
```

If no port specified the Gateway listens at http://localhost:3432/

This will set up a gateway that will listen to all traffic in a specific port, detect the domain, host, subdomain and act accordingly.

### Constructor:

* Initializes a new instance of the Gateway class.

```js
class Gateway {
  constructor({   
   host = process.env.HOST || 'localhost', 
   port = process.env.NETGET_PORT || 3432, 
   routes = {},
   domainsConfigPath = process.env.DOMAINS_CONFIG_PATH || '~/.get/domains.json' 
  } = {}) {
   this.host = host;
   this.port = port;
   this.routes = routes;
   this.domainsConfigPath = domainsConfigPath;
   this.app = express();
   this.initialize().catch(err => console.error('Initialization error:', err));
  }
```



It **detects the host making the request**, the domain and the subdomain. Acting accordingly through the routes given and its handlers.


### Scalable Web Services

In a microservices architecture, **NetGet can route requests to different services** within your infrastructure, making it an ideal solution for developers looking to scale their applications horizontally. Each service can have its own domain, and **NetGet** will ensure that requests are forwarded to the correct service.

### Personal Hosting Solutions

For personal web hosting, **NetGet** provides an **easy-to-set-up gateway** for routing traffic to various self-hosted applications. 

### Secure Access Control

Combined with authentication layers, NetGet can control access to various parts of a web infrastructure, ensuring that only authorized users can access specific services.

# 



## By Neurons.me 

#### **License & Policies**

- **License**: MIT License (see LICENSE for details).

- **Privacy Policy**: Respects user privacy; no collection/storage of personal data.

- **Terms of Usage**: Use responsibly. No guarantees/warranties provided. [Terms](https://www.neurons.me/terms-of-use) | [Privacy](https://www.neurons.me/privacy-policy)

  <img src="https://suign.github.io/neurons.me/neurons_logo.png" alt="neurons.me logo" width="123" height="123" style="width123px; height:123px;">
