// Slice 2 contract: what this netget knows about its own network, without
// touching monad or the .me kernel. Two distinct layers — conflating them is
// exactly the bug Slice 1 fixed in the UI (ports wiring to every row,
// including entrypoints that don't resolve through a monad at all):
//
//   NetworkEntrypoint — a door into THIS netget's own resolver (localhost,
//   127.0.0.1, local.netget, the public main server). Never monad-resolved.
//
//   SemanticSurface   — a real registered domain, a monad-resolved app.
//
// The Lua handler (lua/handlers/surface_resolution.lua) is the runtime
// source of truth and returns exactly this shape; this file is the
// documented contract, not a build dependency of the JS frontend yet (see
// AGENTS.md / Slice 2 scope — no shared-package migration in this slice).

export type SurfaceStatus = 'active' | 'pending_dns' | 'pending_cert' | 'local_only';

export type NetworkEntrypointKind = 'loopback' | 'lan' | 'public';

export interface NetworkEntrypoint {
  id: string;
  host: string;
  kind: NetworkEntrypointKind;
  status: SurfaceStatus;
}

export interface SemanticSurface {
  id: string;
  kind: 'domain';
  publicHost: string;
  status: SurfaceStatus;
  // Whether SSL is configured for this domain at all — independent of
  // `status`: a domain can be status="active" over plain HTTP (sslMode
  // off/none) just as validly as status="active" with a cert on record.
  httpsCapable: boolean;
}

export interface EntrypointsResponse {
  success: true;
  entrypoints: NetworkEntrypoint[];
}

export interface SurfacesResponse {
  success: true;
  surfaces: SemanticSurface[];
}
