---
layout: gui-doc
title: "Domain Routing Structure — netget"
description: "How OpenResty, the domain-map, and SSL provisioning fit together in netget."
image: https://suign.github.io/assets/imgs/netget1.png
mepath:
  - text: netget
    url: https://neurons-me.github.io/netget/
  - text: docs
    url: https://neurons-me.github.io/netget/docs/
crumb: Structure
---

# Domain Routing Structure

* Main server name: el dominio "ancla" del servidor (ej. netget.site). Se guarda en xConfig.mainServerName (parseMainServerName/changeServerName en mainServer/utils.ts).

Dominios de usuarios: cualquiera apunta:
A record → IP pública netget, o CNAME → main server name (ej netget.site).

netget recibe el request por OpenResty (default_server en puerto 80/443 — setNginxConfigFile.ts).

Lua mira el domain-map (domain-map.json, generado por generateDomainMap() desde el domainStore / .me kernel):
Si el Host está registrado → enruta según type (proxy/server/static) con su SSL (sslCertificate/sslCertificateKey por dominio, vía certbot — ya existe certbotProvision.ts).
Si no está registrado → debería caer a una página "Domain not found on netget" con instrucciones de alta (A record o CNAME). Esto es lo que falta.

---
