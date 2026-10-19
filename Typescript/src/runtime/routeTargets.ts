// routeTargets.ts -- what a domain route may point at, and what each kind of destination is.
//
// One definition for every way a route is written (the panel's /add-domain and /update-domain, `netget routing`, the
// store). The router (the main nginx.conf) and the connections of a door (doorConnections.ts) apply the same
// protections to what they are given; a route is not allowed to do through one entry what another entry refuses.
//
// SUPPORTED destination kinds (declared, not inferred):
//   static   an absolute folder of files            target: /abs/path
//   server   a service at host:port                 target: 127.0.0.1:4000, rpi.local:8080
//   app      an app registered with this gateway    target: app:<name>   (a type `server` or `proxy` route)
//   proxy    the monad's own semantic surface       target: (none)
// Not supported yet: an upstream over TLS (https://...), a path on the target, another gateway as a destination.

export type DestinationKind = 'static' | 'server' | 'app' | 'proxy';

export interface RouteTargetContext {
  /** Ports of the apps registered with this gateway: reached by `app:<name>`, never by port. */
  registeredPorts?: Iterable<number>;
}

export type RouteTargetCheck =
  | { ok: true; kind: DestinationKind; type: string; target: string }
  | { ok: false; code: string; reason: string };

/** Ports that belong to the gateway itself (nginx, netget's backend). Never a route target, on any loopback name. */
export const GATEWAY_PORTS: readonly number[] = Object.freeze([80, 443, 3000]);

export const DESTINATION_KINDS: ReadonlyArray<{ kind: DestinationKind; label: string; type: string; example: string; note: string }> = Object.freeze([
  { kind: 'app', label: 'App registrada', type: 'server', example: 'app:fulltrailer', note: 'Una app que se registró en este gateway. Hereda su política de exposición y autorización.' },
  { kind: 'server', label: 'Servicio en un puerto', type: 'server', example: '127.0.0.1:4000', note: 'Un servicio HTTP en host:puerto (esta máquina u otra de la red).' },
  { kind: 'static', label: 'Carpeta de archivos', type: 'static', example: '/Users/yo/mi-sitio/dist', note: 'Una carpeta absoluta con index.html.' },
  { kind: 'proxy', label: 'Superficie del monad', type: 'proxy', example: '', note: 'Lo resuelve el monad de este gateway; sin destino.' },
]);

const LOOPBACK = /^(127(\.\d{1,3}){3}|localhost|0\.0\.0\.0|::1|\[::1\])$/i;
const LINK_LOCAL = /^169\.254(\.\d{1,3}){2}$/;
const HOSTNAME = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function checkRouteTarget(typeIn: unknown, targetIn: unknown, context: RouteTargetContext = {}): RouteTargetCheck {
  const type = String(typeIn ?? '').trim().toLowerCase();
  const target = String(targetIn ?? '').trim();
  const refuse = (code: string, reason: string): RouteTargetCheck => ({ ok: false, code, reason });

  if (type === 'static') {
    if (!target) return refuse('TARGET_REQUIRED', 'una carpeta estática necesita su ruta absoluta');
    if (!target.startsWith('/')) return refuse('STATIC_NOT_ABSOLUTE', 'la carpeta debe ser una ruta absoluta');
    if (target.includes('\0') || target.split('/').some((s) => s === '..')) return refuse('STATIC_PATH', 'la ruta no puede contener ".." ni caracteres de control');
    if (target.length > 1024) return refuse('STATIC_PATH', 'la ruta es demasiado larga');
    return { ok: true, kind: 'static', type: 'static', target: target.length > 1 ? target.replace(/\/+$/, '') : target };
  }

  if (type === 'proxy' && target === '') return { ok: true, kind: 'proxy', type: 'proxy', target: '' };

  if (type === 'server' || type === 'proxy') {
    if (!target) return refuse('TARGET_REQUIRED', 'un servicio necesita host:puerto, o app:<nombre>');

    const app = /^app:(.*)$/i.exec(target);
    if (app) {
      if (!APP_NAME.test(app[1])) return refuse('APP_NAME', 'el nombre de la app solo admite letras, números, punto, guion y guion bajo');
      return { ok: true, kind: 'app', type, target: `app:${app[1]}` };
    }

    // A bare port ("8181") is how routes have always been written for a service on this machine (the CLI's forward-port
    // prompt and the legacy migration normalize it the same way): it means 127.0.0.1:<port>.
    if (/^\d{1,5}$/.test(target)) return checkRouteTarget(type, `127.0.0.1:${Number(target)}`, context);

    if (/^https:\/\//i.test(target)) return refuse('UPSTREAM_TLS', 'un destino por TLS (https://) todavía no está soportado: usa host:puerto');
    const m = /^(?:http:\/\/)?(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(\d{1,5})\/?$/.exec(target);
    if (!m) return refuse('TARGET_SHAPE', 'el destino debe ser host:puerto (sin ruta ni credenciales) o app:<nombre>');
    const host = m[1];
    const port = Number(m[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse('PORT_RANGE', 'el puerto debe estar entre 1 y 65535');
    const bare = host.startsWith('[') ? host : host.toLowerCase();
    if (!bare.startsWith('[') && !HOSTNAME.test(bare)) return refuse('HOST', 'el host no es un nombre válido');
    if (LINK_LOCAL.test(bare)) return refuse('LINK_LOCAL', 'las direcciones link-local (169.254.x.x, p. ej. metadatos de nube) no son un destino');
    if (LOOPBACK.test(bare)) {
      if (GATEWAY_PORTS.includes(port)) return refuse('GATEWAY_PORT', `el puerto ${port} es del propio gateway`);
      for (const p of context.registeredPorts ?? []) {
        if (p === port) return refuse('REGISTERED_APP_PORT', `el puerto ${port} es de una app registrada: apunta a ella con app:<nombre>, no por puerto`);
      }
    }
    return { ok: true, kind: 'server', type, target: `${host}:${port}` };
  }

  return refuse('TYPE', `tipo "${type || '(vacío)'}" no soportado: usa static, server o proxy`);
}
