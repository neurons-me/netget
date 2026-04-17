<img src="https://suign.github.io/assets/imgs/netget1.png" alt="netget" width="377px" style="display: block; margin: 0 auto;"/>

# NetGet
> Expose your services securely. Route with clarity.
### Install once, control everything.

---

```bash
npm i -g netget
```

**Then simply run:**

```bash
netget
```

### What NetGet does
**NetGet** is a modern, lightweight **reverse proxy built on OpenResty**. It turns any server into a clean, secure entry point for your applications.

- Automatically handles **HTTP → HTTPS** redirection
- Issues and **renews SSL certificates** *(including wildcards)* via **Let’s Encrypt**
- **Routes domains and subdomains** to either **Static** builds **or** internal **PORT** services.
- **Gives you full control** through a simple terminal interface
- Includes built-in port diagnostics and process management

### 🔧 How it works
**Point your domain’s** DNS (A or CNAME record) **to your** server’s **public IP.**
Then use the **NetGet** to register where each domain should go:

- A React frontend → static folder
- An API backend → specific port
- Anything else → proxy

**NetGet** takes care of the rest: routing, encryption, and SSL renewal.

### Perfect for
- Solo developers exposing personal projects
- Self-hosted applications
- Building modular architectures on top of **.me** and **Cleaker**.
- Managing multiple services on a single server

**Simple. Secure. Yours.**

---

Made with by [neurons.me](https://www.neurons.me)

**MIT License** • Terms • Privacy

<img src="https://docs.neurons.me/neurons.me.webp" alt="neurons.me logo" width="123" height="123">
