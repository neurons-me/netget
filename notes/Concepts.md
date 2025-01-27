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