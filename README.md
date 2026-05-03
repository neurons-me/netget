<img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;"/>

## Expose your services securely ⚡ Route with clarity.
## Place your Monads. Resolve their endpoints.

#### Control your flow && Install:

---

```bash
npm i -g netget
```

**Then run on your terminal:**

```bash
netget
```

### What it does
**netget** is a modern, lightweight **reverse proxy and placement layer** built on OpenResty. It turns any host into a clean, secure entry point for applications and Monads.

- Automatically handles **HTTP → HTTPS** redirection
- Issues and **renews SSL certificates** *(including wildcards)* via **Let’s Encrypt**
- **Routes domains and subdomains** to either **Static** builds **or** internal **PORT** services.
- **Gives you full control** through a simple terminal interface
- Includes built-in port diagnostics and process management
- Resolves where a Monad physically runs: localhost, laptop, iPhone, Raspberry Pi, VM, relay, or public domain
- Keeps endpoint/port concerns out of the namespace

In the Neuroverse stack:

```txt
.me       -> meaning / seed / semantic tree
cleaker   -> mounts .me into a namespace
monad.ai  -> invisible execution routes inside that namespace
netget    -> physical placement + endpoint resolver
```

A namespace is not a port:

```txt
jabellae.cleaker.me/profile                 semantic path / meaning
jabellae.cleaker.me/photos/iphone           semantic path / meaning
jabellae.cleaker.me/.mesh/monads            internal Monad registry
jabellae.cleaker.me[monadlisa]/profile      technical execution override
monadlisa@127.0.0.1:8161                    Monad instance + endpoint
```

NetGet can resolve:

```txt
netget://iphone/monadlisa      -> http://10.0.0.12:8161
netget://raspberry/worker-a    -> http://192.168.1.44:42137
netget://vm-prod/api           -> https://vm.example.com/_monads/api
```

### How it works 🔧
**Point your domain’s** DNS (A or CNAME record) **to your** server’s **public IP.**
Then use the **NetGet** **main server** to register where each domain should go:

- A React frontend → static folder
- An API backend → specific port
- Anything else → proxy

**NetGet** takes care of the rest: routing, encryption, and SSL renewal.

For Monads, NetGet is the body-finder:

```txt
user intent: read jabellae.cleaker.me/photos/iphone
NRP: choose the best Monad route internally
NetGet: resolve that Monad route to a current endpoint
```

If an operator needs to debug a specific route, the NRP can still force it:

```txt
me://jabellae.cleaker.me[monadlisa]/photos/iphone
```

That selector changes execution only. It does not change the namespace or path meaning.

### Perfect for
- Developers exposing projects
- Self-hosted applications
- Building modular architectures on top of **.me** and **Cleaker**.
- Managing multiple services on a single server
- Running many Monads in one namespace without confusing ports with identity

**Simple. Secure. Yours.**

---

made by [neurons.me](https://www.neurons.me)
**MIT License** 

<img src="https://suign.github.io/assets/imgs/neurons_me_logo.png" alt="neurons.me logo" width="89">
