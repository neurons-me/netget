export type NetGetVisibility = 'loopback' | 'lan' | 'wan';
export type NetGetPublishMode = 'none' | 'path' | 'subdomain' | 'domain';
export type NetGetTlsMode = 'none' | 'self-signed' | 'letsencrypt' | 'manual';
export type NetGetAuthMode = 'none' | 'session' | 'token' | 'basic' | 'oauth-proxy';
export interface NetGetExposurePolicy {
    enabled: boolean;
    visibility: NetGetVisibility;
    publishMode: NetGetPublishMode;
    inbound: {
        allowHttp: boolean;
        allowHttps: boolean;
        allowWebsocket?: boolean;
        bindHosts?: string[];
        paths?: string[];
        subdomain?: string;
        domain?: string;
    };
    tls: {
        mode: NetGetTlsMode;
        redirectHttpToHttps?: boolean;
        certificateRef?: string;
    };
    auth: {
        mode: NetGetAuthMode;
        requiredForRead: boolean;
        requiredForControl: boolean;
        requiredForDestructive: boolean;
        rolesAllowed?: string[];
    };
    control: {
        read: boolean;
        control: boolean;
        destructive: boolean;
    };
    network: {
        allowLoopback?: boolean;
        allowLan?: boolean;
        allowWan?: boolean;
        allowCidrs?: string[];
        denyCidrs?: string[];
        trustedProxies?: string[];
    };
    redirect: {
        canonicalHost?: string;
        additionalHosts?: string[];
        forceCanonicalHost?: boolean;
    };
    headers?: {
        forwardedHost?: boolean;
        forwardedProto?: boolean;
        forwardedFor?: boolean;
        frameAncestors?: string[];
        csp?: string;
    };
}
export type NetGetExposurePolicyInput = Partial<{
    [K in keyof NetGetExposurePolicy]: NetGetExposurePolicy[K] extends Record<string, unknown> ? Partial<NetGetExposurePolicy[K]> : NetGetExposurePolicy[K];
}>;
export declare const DEFAULT_NETGET_EXPOSURE_POLICY: NetGetExposurePolicy;
export declare function mergeNetGetExposurePolicy(...policies: Array<NetGetExposurePolicyInput | null | undefined>): NetGetExposurePolicy;
export declare function resolveNetGetExposurePolicy(input?: {
    systemPolicy?: NetGetExposurePolicyInput | null;
    appDeclaredPolicy?: NetGetExposurePolicyInput | null;
    adminOverrides?: NetGetExposurePolicyInput | null;
    runtimeConstraints?: NetGetExposurePolicyInput | null;
}): NetGetExposurePolicy;
//# sourceMappingURL=exposurePolicy.d.ts.map