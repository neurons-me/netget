export const DEFAULT_NETGET_EXPOSURE_POLICY = {
    enabled: true,
    visibility: 'loopback',
    publishMode: 'path',
    inbound: {
        allowHttp: true,
        allowHttps: false,
        allowWebsocket: false,
        bindHosts: ['local.netget', 'localhost', '127.0.0.1'],
        paths: [],
    },
    tls: {
        mode: 'none',
        redirectHttpToHttps: false,
    },
    auth: {
        mode: 'session',
        requiredForRead: false,
        requiredForControl: true,
        requiredForDestructive: true,
        rolesAllowed: ['admin'],
    },
    control: {
        read: true,
        control: false,
        destructive: false,
    },
    network: {
        allowLoopback: true,
        allowLan: false,
        allowWan: false,
        allowCidrs: [],
        denyCidrs: [],
        trustedProxies: [],
    },
    redirect: {
        additionalHosts: [],
        forceCanonicalHost: false,
    },
    headers: {
        forwardedHost: true,
        forwardedProto: true,
        forwardedFor: true,
        frameAncestors: ["'self'"],
    },
};
function mergeObject(base, next) {
    return { ...base, ...(next || {}) };
}
function normalizeStringArray(values) {
    if (!Array.isArray(values))
        return undefined;
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}
function applyRuntimeConstraints(policy) {
    const next = {
        ...policy,
        inbound: { ...policy.inbound },
        tls: { ...policy.tls },
        auth: { ...policy.auth },
        control: { ...policy.control },
        network: { ...policy.network },
        redirect: { ...policy.redirect },
        headers: policy.headers ? { ...policy.headers } : undefined,
    };
    if (next.visibility === 'loopback') {
        next.network.allowLoopback = true;
        next.network.allowLan = false;
        next.network.allowWan = false;
    }
    if (next.visibility === 'lan') {
        next.network.allowLoopback = true;
        next.network.allowLan = true;
        next.network.allowWan = false;
    }
    if (next.visibility === 'wan') {
        next.network.allowLoopback = true;
        next.network.allowLan = true;
        next.network.allowWan = true;
    }
    if (next.publishMode === 'domain' && !next.inbound.domain) {
        next.enabled = false;
    }
    if (next.publishMode === 'subdomain' && !next.inbound.subdomain) {
        next.enabled = false;
    }
    if (next.control.destructive) {
        next.auth.requiredForDestructive = true;
        if (next.auth.mode === 'none')
            next.auth.mode = 'session';
    }
    if (next.control.control) {
        next.auth.requiredForControl = true;
        if (next.auth.mode === 'none')
            next.auth.mode = 'session';
    }
    if (next.tls.mode === 'none') {
        next.inbound.allowHttps = false;
        next.tls.redirectHttpToHttps = false;
    }
    return next;
}
export function mergeNetGetExposurePolicy(...policies) {
    let current = {
        ...DEFAULT_NETGET_EXPOSURE_POLICY,
        inbound: { ...DEFAULT_NETGET_EXPOSURE_POLICY.inbound },
        tls: { ...DEFAULT_NETGET_EXPOSURE_POLICY.tls },
        auth: { ...DEFAULT_NETGET_EXPOSURE_POLICY.auth },
        control: { ...DEFAULT_NETGET_EXPOSURE_POLICY.control },
        network: { ...DEFAULT_NETGET_EXPOSURE_POLICY.network },
        redirect: { ...DEFAULT_NETGET_EXPOSURE_POLICY.redirect },
        headers: { ...DEFAULT_NETGET_EXPOSURE_POLICY.headers },
    };
    for (const policy of policies) {
        if (!policy)
            continue;
        current = {
            ...current,
            ...policy,
            inbound: mergeObject(current.inbound, policy.inbound),
            tls: mergeObject(current.tls, policy.tls),
            auth: mergeObject(current.auth, policy.auth),
            control: mergeObject(current.control, policy.control),
            network: mergeObject(current.network, policy.network),
            redirect: mergeObject(current.redirect, policy.redirect),
            headers: mergeObject(current.headers || {}, policy.headers),
        };
    }
    const inboundBindHosts = normalizeStringArray(current.inbound.bindHosts);
    const inboundPaths = normalizeStringArray(current.inbound.paths);
    const rolesAllowed = normalizeStringArray(current.auth.rolesAllowed);
    const allowCidrs = normalizeStringArray(current.network.allowCidrs);
    const denyCidrs = normalizeStringArray(current.network.denyCidrs);
    const trustedProxies = normalizeStringArray(current.network.trustedProxies);
    const additionalHosts = normalizeStringArray(current.redirect.additionalHosts);
    const frameAncestors = normalizeStringArray(current.headers?.frameAncestors);
    current.inbound.bindHosts = inboundBindHosts;
    current.inbound.paths = inboundPaths;
    current.auth.rolesAllowed = rolesAllowed;
    current.network.allowCidrs = allowCidrs;
    current.network.denyCidrs = denyCidrs;
    current.network.trustedProxies = trustedProxies;
    current.redirect.additionalHosts = additionalHosts;
    if (current.headers)
        current.headers.frameAncestors = frameAncestors;
    return applyRuntimeConstraints(current);
}
export function resolveNetGetExposurePolicy(input = {}) {
    return mergeNetGetExposurePolicy(input.systemPolicy, input.appDeclaredPolicy, input.adminOverrides, input.runtimeConstraints);
}
