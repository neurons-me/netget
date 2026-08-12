// A Surface is "the thing that answers/is reachable at a namespace" — the
// common shape that apps.json entries, SurfaceAccessTable's old hardcoded
// rows, and WelcomeNetget.jsx's domainRows/portsWithStatus each converged on
// independently. Not a kernel/algebra type — netget's own resolution result.
export type SurfaceKind = 'netget' | 'monad' | 'direct' | 'public';
export type SurfaceTrust = 'owner' | 'admin' | 'peer' | 'guest';

export interface Surface {
  namespace: string;
  kind: SurfaceKind;
  endpoint?: string;
  identity?: string;
  trust?: SurfaceTrust;
  online: boolean;
  lastSeenMs?: number;
}
