import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Monad } from 'this.gui';
import './css/styles.css';

// Network entrypoints — doors into this same netget resolver, not apps.
// Distinct from SEMANTIC SURFACES (real registered domains, below): an
// entrypoint doesn't resolve to a monad-served app by itself, it's just a
// way to reach this netget's own control plane. See entrypointRows/surfaceRows below.
const BASE_SURFACES = ['localhost', '127.0.0.1', 'local.netget', 'netget.site'];
const HOSTNAME_PLACEHOLDER = 'hostname.local';
const REQUEST_LIMIT = 18;
const SEEN_LOG_LIMIT = 80;
const SURFACE_HISTORY_LIMIT = 12;
const WINDOW_STATE_KEY = 'netgetLanding';

// Small "i" affordance — hover/focus reveals an explanation bubble. Plain
// CSS (:hover/:focus-within), no JS state, so it can't get out of sync with
// the control it's attached to.
const InfoTip = ({ text }) => (
    <span className="info-tip" tabIndex={0}>
        <span className="info-tip-icon" aria-hidden="true">i</span>
        <span className="info-tip-bubble" role="tooltip">{text}</span>
    </span>
);

function uniqueHosts(hosts) {
    return [...new Set(hosts.filter(Boolean))];
}

function normalizeSurface(surface) {
    const cleanSurface = String(surface || '').trim().toLowerCase();
    return cleanSurface && cleanSurface !== HOSTNAME_PLACEHOLDER ? cleanSurface : '';
}

function sanitizeSurfaceHistory(history) {
    if (!Array.isArray(history)) return [];
    return uniqueHosts(history.map(normalizeSurface)).slice(0, SURFACE_HISTORY_LIMIT);
}

function addSurfaceToHistory(surface, history = []) {
    const cleanSurface = normalizeSurface(surface);
    const cleanHistory = sanitizeSurfaceHistory(history);

    if (!cleanSurface) return cleanHistory;

    return uniqueHosts([cleanSurface, ...cleanHistory]).slice(0, SURFACE_HISTORY_LIMIT);
}

function getCurrentHost() {
    if (typeof window === 'undefined') return BASE_SURFACES[0];
    return normalizeSurface(window.location.host) || BASE_SURFACES[0];
}

function getCurrentPort() {
    if (typeof window === 'undefined') return '80';
    if (window.location.port) return window.location.port;
    return window.location.protocol === 'https:' ? '443' : '80';
}

function readWindowState() {
    if (typeof window === 'undefined') return {};

    try {
        const parsed = JSON.parse(window.name || '{}');
        return parsed && typeof parsed === 'object' ? parsed[WINDOW_STATE_KEY] || {} : {};
    } catch {
        return {};
    }
}

function writeWindowState(nextState) {
    if (typeof window === 'undefined') return;

    let parsed = {};
    try {
        parsed = JSON.parse(window.name || '{}');
        if (!parsed || typeof parsed !== 'object') parsed = {};
    } catch {
        parsed = {};
    }

    window.name = JSON.stringify({
        ...parsed,
        [WINDOW_STATE_KEY]: {
            ...(parsed[WINDOW_STATE_KEY] || {}),
            ...nextState,
        },
    });
}

function nowStamp() {
    return new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function entryLabel(method, target, status) {
    return `${method} ${target} -> ${status}`;
}

function compactText(value, limit = 86) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function getLogKey(logEntry) {
    if (typeof logEntry === 'string') return logEntry;
    return logEntry.fullLine || [
        logEntry.timestamp,
        logEntry.method,
        logEntry.path,
        logEntry.status,
        logEntry.message,
    ].filter(Boolean).join('|');
}

function formatLogEntry(logEntry) {
    if (typeof logEntry === 'string') {
        const request = logEntry.match(/"([A-Z]+)\s+([^"]+)\s+HTTP\/[0-9.]+"\s+(\d{3})/);
        if (request) {
            const status = Number(request[3]);
            return {
                method: request[1],
                target: request[2],
                status: request[3],
                detail: compactText(logEntry),
                tone: status >= 400 ? 'warn' : 'ok',
            };
        }

        return {
            method: 'ACCESS',
            target: 'log',
            status: 'entry',
            detail: compactText(logEntry),
            tone: 'ok',
        };
    }

    const method = logEntry.method || logEntry.level || 'ACCESS';
    const target = logEntry.path || logEntry.message || 'log';
    const status = logEntry.status || logEntry.level || 'entry';
    const statusNumber = Number(status);
    const detail = compactText([
        logEntry.ip,
        logEntry.timestamp,
        logEntry.message,
    ].filter(Boolean).join(' '));

    return {
        method,
        target,
        status,
        detail,
        tone: statusNumber >= 400 || logEntry.level === 'ERROR' ? 'warn' : 'ok',
    };
}

const DEFAULT_PORTS = [
    { id: '80', label: 'HTTP', port: '80' },
    { id: '443', label: 'HTTPS', port: '443' },
];

const WelcomeNetget = () => {
    const currentHost = getCurrentHost();
    const currentPort = getCurrentPort();
    const seenLogKeys = useRef(new Set());
    const surfaceRefs = useRef({});
    const portRefs = useRef({});
    const monadRef = useRef(null);
    const wireBodyRef = useRef(null);
    const [wirePaths, setWirePaths] = useState([]);
    const [ports, setPorts] = useState(DEFAULT_PORTS);
    // Slice 2: fetched directly from netget's own GET /entrypoints and
    // GET /surfaces (src/types/SurfaceResolution.ts is the documented
    // contract) — the UI no longer infers these from a local BASE_SURFACES
    // constant plus GET /domains. See entrypointRows/surfaceRows below.
    const [entrypoints, setEntrypoints] = useState([]);
    const [surfaces, setSurfaces] = useState([]);
    const [gatewayHost, setGatewayHost] = useState('');
    const [hostnameLoaded, setHostnameLoaded] = useState(false);
    const [gatewayPort, setGatewayPort] = useState(null);
    const [openrestyStatus, setOpenrestyStatus] = useState(null);
    const [openrestyPending, setOpenrestyPending] = useState(null);
    const [requestEntries, setRequestEntries] = useState([
        {
            id: 'boot',
            at: nowStamp(),
            text: entryLabel('BOOT', currentHost, 'watching'),
            detail: 'local request terminal online',
            tone: 'ok',
        },
    ]);
    const [mainView, setMainView] = useState(() => {
        const restoredView = readWindowState().mainView;
        return restoredView === 'terminal' ? 'terminal' : 'netget';
    });
    const [surfaceHistory, setSurfaceHistory] = useState(() => sanitizeSurfaceHistory(readWindowState().surfaceHistory));
    const portsWithStatus = useMemo(() => ports.map((item) => {
        if (item.id === '80') return { ...item, active: hostnameLoaded || currentPort === '80' };
        if (item.id === '443') return { ...item, active: hostnameLoaded || currentPort === '443' || gatewayPort === 443 };
        return { ...item, active: true };
    }), [ports, currentPort, gatewayPort, hostnameLoaded]);
    // Two genuinely different layers, not one flat "domains" list — fetched
    // directly from netget's own GET /entrypoints and GET /surfaces (Slice
    // 2), not inferred from a local BASE_SURFACES constant plus GET /domains:
    //  - entrypointRows (Network Entrypoints): doors into this same netget
    //    resolver. Always valid discovery/recovery entry points, independent
    //    of whatever customer domains are configured. Ports wire to these.
    //  - surfaceRows (Semantic Surfaces): the real customer domains netget is
    //    actually routing for right now, each one a monad-resolved app.
    //    These wire to monad.ai, not the entrypoints.
    // An entrypoint (e.g. local.netget) reaches this netget's own control
    // plane, not a monad-served app by itself — that distinction is why the
    // two groups don't share a wire target.
    const entrypointRows = useMemo(() => entrypoints.map((e) => ({
        surface: e.host,
        selected: e.host === currentHost,
        online: true,
        disabled: false,
        httpsCapable: true,
    })), [entrypoints, currentHost]);

    const surfaceRows = useMemo(() => surfaces.map((s) => ({
        surface: s.publicHost,
        selected: s.publicHost === currentHost,
        online: true,
        disabled: false,
        httpsCapable: !!s.httpsCapable,
    })), [surfaces, currentHost]);
    // Count of >=400/error lines currently visible in the terminal — the same
    // 'warn' tone already used for offline wires and warn terminal lines, so
    // this reuses one signal instead of introducing a second error taxonomy.
    const badRequestCount = useMemo(
        () => requestEntries.filter((entry) => entry.tone === 'warn').length,
        [requestEntries],
    );

    const addRequestEntry = useCallback((method, target, status, detail = '', tone = 'ok') => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const nextEntry = {
            id,
            at: nowStamp(),
            text: entryLabel(method, target, status),
            detail,
            tone,
        };

        setRequestEntries((entries) => [nextEntry, ...entries].slice(0, REQUEST_LIMIT));
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function requestJson(target) {
            const startedAt = performance.now();
            try {
                const response = await fetch(target, { cache: 'no-store', credentials: 'same-origin' });
                const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
                const contentType = response.headers.get('content-type') || '';
                const responseType = contentType.split(';')[0] || 'unknown';

                if (!response.ok) {
                    addRequestEntry('GET', target, response.status, `${elapsedMs}ms ${responseType}`, 'warn');
                    return null;
                }

                if (!contentType.includes('application/json')) {
                    addRequestEntry('GET', target, 'not-json', `${elapsedMs}ms ${responseType}`, 'warn');
                    return null;
                }

                addRequestEntry('GET', target, response.status, `${elapsedMs}ms ${responseType}`, 'ok');
                return response.json();
            } catch (error) {
                addRequestEntry('GET', target, 'fail', error instanceof Error ? error.message : 'request failed', 'warn');
                return null;
            }
        }

        async function pollNetget() {
            const identity = await requestJson('/gateway-identity');
            if (cancelled) return;

            if (identity) {
                const nextGatewayHost = String(identity.gatewayId || '').trim().toLowerCase();
                setGatewayHost(nextGatewayHost.endsWith('.local') ? nextGatewayHost : '');
                setHostnameLoaded(!!nextGatewayHost);
                setGatewayPort(Number(identity.port) || null);
            } else {
                if (!cancelled) {
                    setGatewayHost('');
                    setHostnameLoaded(false);
                    setGatewayPort(null);
                }
            }

            const openresty = await requestJson('/openresty-status');
            if (!cancelled) setOpenrestyStatus(openresty);

            const apps = await requestJson('/apps');
            if (!cancelled && apps) {
                addRequestEntry('MESH', '/apps', `${apps.count ?? 0} live`, apps.updatedAt || 'registry snapshot', 'ok');
            }

            const entrypointsResponse = await requestJson('/entrypoints');
            if (!cancelled) {
                setEntrypoints(Array.isArray(entrypointsResponse?.entrypoints) ? entrypointsResponse.entrypoints : []);
            }

            const surfacesResponse = await requestJson('/surfaces');
            if (!cancelled) {
                setSurfaces(Array.isArray(surfacesResponse?.surfaces) ? surfacesResponse.surfaces : []);
            }

            await requestJson('/healthcheck');

            const accessLogs = await requestJson('/logs?type=access&limit=6');
            if (!cancelled && Array.isArray(accessLogs?.logs)) {
                accessLogs.logs.slice().reverse().forEach((logEntry) => {
                    const key = getLogKey(logEntry);
                    if (!key || seenLogKeys.current.has(key)) return;

                    if (seenLogKeys.current.size > SEEN_LOG_LIMIT) {
                        seenLogKeys.current.clear();
                    }

                    seenLogKeys.current.add(key);
                    const formatted = formatLogEntry(logEntry);
                    addRequestEntry(formatted.method, formatted.target, formatted.status, formatted.detail, formatted.tone);
                });
            }
        }

        pollNetget();
        const timer = window.setInterval(pollNetget, 5000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [addRequestEntry]);

    useEffect(() => {
        if (mainView !== 'netget') return;
        const selectedSurface = surfaceRefs.current[currentHost];
        if (!selectedSurface) return;
        // Scroll only the small address list itself into position, not
        // scrollIntoView() — that walks every scrollable ancestor, and now
        // that .netget-console can scroll too (layers wrap at narrow
        // widths), it would also re-center the whole console around this
        // row, dragging the title out of view.
        const historyEl = selectedSurface.closest('.surface-history');
        if (!historyEl) return;
        historyEl.scrollTop =
            selectedSurface.offsetTop - historyEl.clientHeight / 2 + selectedSurface.clientHeight / 2;
    }, [currentHost, mainView, entrypointRows.length, surfaceRows.length]);

    useEffect(() => {
        writeWindowState({ mainView });
    }, [mainView]);

    useEffect(() => {
        setSurfaceHistory((history) => {
            const nextHistory = addSurfaceToHistory(currentHost, history);
            writeWindowState({ surfaceHistory: nextHistory });
            return nextHistory;
        });
    }, [currentHost]);

    const navigateToSurface = (nextHost) => {
        if (typeof window === 'undefined') return;
        const normalizedNextHost = normalizeSurface(nextHost);
        if (!normalizedNextHost) return;

        const { protocol, host, pathname, search, hash } = window.location;

        // Clicking the surface you're already on proceeds into the app
        // (this used to be the separate "Enter" button).
        if (normalizedNextHost === normalizeSurface(host)) {
            window.location.href = `${protocol}//${host}/home`;
            return;
        }

        const nextHistory = addSurfaceToHistory(normalizedNextHost, surfaceHistory);
        setSurfaceHistory(nextHistory);
        writeWindowState({ mainView, surfaceHistory: nextHistory });
        window.location.href = `${protocol}//${normalizedNextHost}${pathname}${search}${hash}`;
    };

    const handleAddPort = () => {
        if (typeof window === 'undefined') return;
        const input = window.prompt('Port number to listen on?');
        if (input == null) return;
        const trimmed = input.trim();
        if (!/^\d{1,5}$/.test(trimmed)) return;
        setPorts((current) => {
            if (current.some((item) => item.port === trimmed)) return current;
            const label = trimmed === '443' ? 'HTTPS' : trimmed === '80' ? 'HTTP' : 'TCP';
            return [...current, { id: trimmed, label, port: trimmed }];
        });
    };

    const openrestyOnline = !!(openrestyStatus?.httpListening || openrestyStatus?.httpsListening);

    // Restart/stop are real, blocking OpenResty control-plane calls (netget
    // reload/stop -> openRestyService.ts, which shells out through sudo) — not
    // decorative footswitches. A failure (most likely: this backend has no
    // passwordless sudo rule for the OpenResty command) surfaces as a warn
    // line in the same terminal feed as every other real request, rather than
    // failing silently.
    const runOpenrestyAction = useCallback(async (action, endpoint) => {
        if (openrestyPending) return;
        setOpenrestyPending(action);
        const startedAt = performance.now();
        try {
            const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
            const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
            const body = await response.json().catch(() => null);
            const tone = response.ok && body?.ok !== false ? 'ok' : 'warn';
            addRequestEntry('POWER', endpoint, response.status, `${elapsedMs}ms ${body?.message || (tone === 'ok' ? 'done' : 'failed')}`, tone);
        } catch (error) {
            addRequestEntry('POWER', endpoint, 'fail', error instanceof Error ? error.message : 'request failed', 'warn');
        } finally {
            setOpenrestyPending(null);
        }
    }, [openrestyPending, addRequestEntry]);

    const handleOpenRestyRestart = () => runOpenrestyAction('restart', '/openresty-restart');

    const handleOpenRestyToggle = () => {
        if (openrestyOnline) {
            if (typeof window !== 'undefined' && !window.confirm('Stop the NetGet gateway? This will take down every address it is currently routing, including this page.')) {
                return;
            }
            runOpenrestyAction('stop', '/openresty-stop');
        } else {
            runOpenrestyAction('restart', '/openresty-restart');
        }
    };

    // Real wiring: one path per (port, address) pair, colored by that address's
    // live status and the port's protocol — not decorative.
    useEffect(() => {
        const container = wireBodyRef.current;
        if (!container || mainView !== 'netget') return undefined;

        function computeWires() {
            const containerRect = container.getBoundingClientRect();
            const historyEl = container.querySelector('.surface-history');
            const historyRect = historyEl ? historyEl.getBoundingClientRect() : null;
            const nextPaths = [];

            // Shared clearance point, past every port chip's right edge — not
            // just the one a given wire starts from. Ports stack vertically,
            // so a wire from the top port (80) to a row below the bottom
            // port (443) has to pass 443's own Y-range on the way down;
            // bulging out only as far as its own port's edge still cuts
            // straight through that other chip's box. Same fix as the
            // address->monad wires below.
            const portsClearX =
                Math.max(
                    ...portsWithStatus
                        .map((port) => portRefs.current[port.id])
                        .filter(Boolean)
                        .map((el) => el.getBoundingClientRect().right - containerRect.left),
                ) + 24;

            portsWithStatus.forEach((port) => {
                const portEl = portRefs.current[port.id];
                if (!portEl) return;
                const portRect = portEl.getBoundingClientRect();
                const startX = portRect.right - containerRect.left;
                const startY = portRect.top - containerRect.top + portRect.height / 2;

                entrypointRows.forEach((row) => {
                    if (row.disabled) return;

                    // Every netget domain answers on 80; it only answers on 443 if
                    // its own sslMode says so. Custom ports added via "+" have no
                    // per-domain data to match against, so they stay unwired.
                    const portMatches = port.id === '80' ? true : port.id === '443' ? row.httpsCapable : false;
                    if (!portMatches) return;

                    const rowEl = surfaceRefs.current[row.surface];
                    if (!rowEl) return;
                    const rowRect = rowEl.getBoundingClientRect();

                    // Clip to the scrollable list's own viewport (not the wider body).
                    // Rows scrolled past the top edge are hard-clipped (so are hard-skipped);
                    // rows inside the bottom mask-image fade get a matching fade on the wire
                    // itself, so the line dims out in sync with its row instead of either
                    // vanishing early or dangling past content that's already gone.
                    let fade = 1;
                    if (historyRect) {
                        if (rowRect.top < historyRect.top || rowRect.top >= historyRect.bottom) return;
                        const fadeStart = historyRect.top + historyRect.height * 0.84;
                        const rowCenter = (rowRect.top + rowRect.bottom) / 2;
                        if (rowCenter > fadeStart) {
                            const fadeRange = historyRect.bottom - fadeStart;
                            fade = fadeRange > 0 ? Math.max(0, 1 - (rowCenter - fadeStart) / fadeRange) : 0;
                        }
                        if (fade <= 0.02) return;
                    }

                    const endX = rowRect.left - containerRect.left;
                    const endY = rowRect.top - containerRect.top + rowRect.height / 2;
                    const tone = !port.active || !row.online ? 'offline' : port.label === 'HTTPS' ? 'https' : 'http';

                    nextPaths.push({
                        key: `${port.id}:${row.surface}`,
                        d: `M${startX},${startY} C${portsClearX},${startY} ${portsClearX},${endY} ${endX},${endY}`,
                        tone,
                        fade,
                    });
                });
            });

            const monadEl = monadRef.current;
            if (monadEl) {
                const monadRect = monadEl.getBoundingClientRect();
                // Extend slightly past the box's border into its padding so the
                // wire visibly enters the chip instead of just grazing the edge.
                const endX = monadRect.left - containerRect.left + 16;
                const endY = monadRect.top - containerRect.top + monadRect.height / 2;

                // Build every row's start point first so the curves can share
                // one clearance point (clearX) past the *longest* label —
                // routing each wire off its own label width bulges shorter
                // labels' wires right through longer labels sitting below them
                // (visible once addresses stack above monad.ai instead of
                // sitting beside it, e.g. wrapped at narrow widths).
                const monadRowData = [];
                surfaceRows.forEach((row) => {
                    if (row.disabled) return;

                    const rowEl = surfaceRefs.current[row.surface];
                    if (!rowEl) return;
                    const rowRect = rowEl.getBoundingClientRect();

                    let fade = 1;
                    if (historyRect) {
                        if (rowRect.top < historyRect.top || rowRect.top >= historyRect.bottom) return;
                        const fadeStart = historyRect.top + historyRect.height * 0.84;
                        const rowCenter = (rowRect.top + rowRect.bottom) / 2;
                        if (rowCenter > fadeStart) {
                            const fadeRange = historyRect.bottom - fadeStart;
                            fade = fadeRange > 0 ? Math.max(0, 1 - (rowCenter - fadeStart) / fadeRange) : 0;
                        }
                        if (fade <= 0.02) return;
                    }

                    // Anchor to the visible label text, not the row button's
                    // full (grid-stretched) width — otherwise the wire starts
                    // in empty space past the end of the address name.
                    const labelEl = rowEl.querySelector('.surface-name');
                    const labelRect = labelEl ? labelEl.getBoundingClientRect() : rowRect;
                    const startX = labelRect.right - containerRect.left + 6;
                    const startY = rowRect.top - containerRect.top + rowRect.height / 2;

                    monadRowData.push({ row, startX, startY, fade });
                });

                const clearX = Math.max(endX, ...monadRowData.map((r) => r.startX)) + 20;

                monadRowData.forEach(({ row, startX, startY, fade }) => {
                    nextPaths.push({
                        key: `surface:${row.surface}:monad`,
                        d: `M${startX},${startY} C${clearX},${startY} ${clearX},${endY} ${endX},${endY}`,
                        tone: row.online && openrestyOnline ? 'monad' : 'monad-offline',
                        fade,
                    });
                });
            }

            setWirePaths(nextPaths);
        }

        computeWires();

        const resizeObserver = new ResizeObserver(computeWires);
        resizeObserver.observe(container);
        if (monadRef.current) resizeObserver.observe(monadRef.current);

        const historyEl = container.querySelector('.surface-history');
        historyEl?.addEventListener('scroll', computeWires, { passive: true });

        return () => {
            resizeObserver.disconnect();
            historyEl?.removeEventListener('scroll', computeWires);
        };
    }, [portsWithStatus, entrypointRows, surfaceRows, mainView, openrestyOnline]);

    const handlePaneKeyDown = (view) => (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        setMainView(view);
    };

    const renderPortRow = () => (
        <div className="port-row" aria-label="NetGet listening ports">
            {portsWithStatus.map((item) => (
                <div key={item.id} className={`port-chip ${item.active ? 'port-chip--on' : 'port-chip--off'}`}>
                    <span>{item.port}</span>
                    <small>{item.label}</small>
                </div>
            ))}
        </div>
    );

    const renderTerminal = (variant) => (
        <section className={`netget-terminal netget-terminal--${variant}`} aria-label="NetGet live request terminal">
            <div className="terminal-header">
                <span>netget://requests</span>
                <strong>live</strong>
            </div>

            {renderPortRow()}

            <div className="terminal-lines">
                {requestEntries.map((entry) => (
                    <div key={entry.id} className={`terminal-line terminal-line--${entry.tone}`}>
                        <span className="terminal-time">{entry.at}</span>
                        <span className="terminal-text">{entry.text}</span>
                        {entry.detail && <span className="terminal-detail">{entry.detail}</span>}
                    </div>
                ))}
            </div>
        </section>
    );

    const renderNetgetDock = () => (
        <section className="netget-dock" aria-label="NetGet surface">
            <div className="netget-dock-word" aria-hidden="true">NETGET</div>
            <div className="netget-dock-host">{currentHost}</div>
        </section>
    );

    const renderOpenRestyControl = () => {
        const statusLabel = !openrestyStatus
            ? 'UNKNOWN'
            : openrestyOnline
                ? (openrestyStatus.mode || 'SERVICE').toUpperCase()
                : 'STOPPED';

        return (
            <div className="openresty-control" aria-label="OpenResty gateway control">
                <div className="openresty-status">
                    <span className={`surface-status-led openresty-led openresty-led--${openrestyOnline ? 'on' : 'off'}`} aria-hidden="true">
                        <span className="surface-status-dot" />
                    </span>
                    <span className="openresty-status-label">{statusLabel}</span>
                    <InfoTip text="Estado real de OpenResty, consultado cada 5s a /openresty-status. UNKNOWN = todavía no llegó respuesta (arrancando o falló la última petición). SERVICE/MANUAL = está corriendo y escuchando. STOPPED = está apagado." />
                    {badRequestCount > 0 && (
                        <span className="openresty-badge openresty-badge--warn" title={`${badRequestCount} bad/error response${badRequestCount === 1 ? '' : 's'} in the visible log`}>
                            {badRequestCount} bad
                        </span>
                    )}
                    <InfoTip text="Peticiones con error (4xx/5xx) o que fallaron, dentro de las últimas 18 líneas visibles en la terminal de requests. No es un total histórico: si desaparecen líneas viejas del log, este número baja solo." />
                </div>
                <div className="openresty-actions">
                    <button
                        type="button"
                        className="openresty-btn"
                        onClick={handleOpenRestyRestart}
                        disabled={!!openrestyPending}
                    >
                        {openrestyPending === 'restart' ? '...' : 'RESTART'}
                    </button>
                    <InfoTip text="Reinicia OpenResty (netget reload). Recarga config + Lua, tarda unos segundos. No borra nada ni afecta a domains.db." />
                    <button
                        type="button"
                        className={`openresty-btn openresty-btn--power ${openrestyOnline ? 'openresty-btn--power-on' : 'openresty-btn--power-off'}`}
                        onClick={handleOpenRestyToggle}
                        disabled={!!openrestyPending}
                    >
                        {openrestyPending === 'stop' ? '...' : openrestyOnline ? 'ON' : 'OFF'}
                    </button>
                    <InfoTip text="Este botón muestra el estado ACTUAL, no la acción del click. 'ON' = está encendido ahora — click lo apaga (pide confirmación, corta esta misma página). 'OFF' = está apagado — click lo enciende." />
                </div>
            </div>
        );
    };

    const renderSurfaceRow = (row) => (
        <button
            key={row.surface}
            ref={(node) => {
                if (node) surfaceRefs.current[row.surface] = node;
            }}
            type="button"
            className={[
                'surface-history-item',
                row.selected ? 'surface-history-item--selected' : '',
                row.online ? 'surface-history-item--online' : 'surface-history-item--offline',
            ].filter(Boolean).join(' ')}
            disabled={row.disabled || !row.online}
            onClick={() => navigateToSurface(row.surface)}
            aria-current={row.selected ? 'true' : undefined}
        >
            <span className="surface-status-led" aria-hidden="true"><span className="surface-status-dot" /></span>
            <span className="surface-name">{row.surface}</span>
        </button>
    );

    const renderNetgetConsole = () => (
        <section className="netget-console" aria-label="NetGet console">
            <div className="netget-body" ref={wireBodyRef}>
                <svg className="netget-wires" aria-hidden="true">
                    {wirePaths.map((wire) => (
                        <path
                            key={wire.key}
                            d={wire.d}
                            className={`netget-wire netget-wire--${wire.tone}`}
                            style={{ opacity: (wire.tone.includes('offline') ? 0.38 : 0.78) * wire.fade }}
                        />
                    ))}
                </svg>

                <div className="netget-header">
                    <div className="netget-word" aria-hidden="true">NETGET</div>
                    {renderOpenRestyControl()}
                </div>

                <div className="netget-layers" aria-label="NetGet request flow">
                    <div className="netget-ports" aria-label="Listening ports">
                        {portsWithStatus.map((item) => (
                            <div
                                key={item.id}
                                ref={(node) => {
                                    if (node) portRefs.current[item.id] = node;
                                }}
                                className={`port-chip ${item.active ? 'port-chip--on' : 'port-chip--off'}`}
                            >
                                <span>{item.port}</span>
                                <small>{item.label}</small>
                            </div>
                        ))}
                        <button type="button" className="port-chip port-chip--add" onClick={handleAddPort} aria-label="Add a listening port">
                            <span>+</span>
                        </button>
                    </div>

                    <div className="netget-addresses">
                        <div className="surface-position-marker" title={currentHost} aria-label={`Current URL: ${currentHost}`}></div>

                        <div className="surface-history" aria-label="Netget entrypoints and semantic surfaces">
                            <div className="surface-group-label" aria-hidden="true">Network Entrypoints</div>
                            {entrypointRows.map((row) => renderSurfaceRow(row))}

                            {surfaceRows.length > 0 ? (
                                <>
                                    <div className="surface-group-label" aria-hidden="true">Semantic Surfaces</div>
                                    {surfaceRows.map((row) => renderSurfaceRow(row))}
                                </>
                            ) : null}
                        </div>
                    </div>

                    <div className="netget-monad-stage" aria-label="Monad entrypoint" ref={monadRef}>
                        <div className={`netget-monad-bubble ${openrestyOnline ? 'netget-monad-bubble--on' : 'netget-monad-bubble--off'}`}>
                            <Monad
                                variant="identity"
                                mode="contained"
                                kind="monad"
                                seed={gatewayHost || currentHost || 'local.netget'}
                                label="monad.ai"
                                healthy={openrestyOnline}
                                size={32}
                            />
                        </div>
                        <span className="netget-monad-label" aria-hidden="true">monad.ai</span>
                    </div>
                </div>
            </div>
        </section>
    );

    return (
        <div className={`welcome-page welcome-page--${mainView}`}>
            <div className="stage-split" aria-label="NetGet background views">
                <div
                    className={`stage-pane stage-pane--left ${mainView === 'terminal' ? 'stage-pane--parked' : 'stage-pane--available'}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setMainView('terminal')}
                    onKeyDown={handlePaneKeyDown('terminal')}
                    aria-label="Show request terminal"
                >
                    {renderTerminal('background')}
                </div>

                <div
                    className={`stage-pane stage-pane--right ${mainView === 'netget' ? 'stage-pane--parked' : 'stage-pane--available'}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setMainView('netget')}
                    onKeyDown={handlePaneKeyDown('netget')}
                    aria-label="Show NetGet console"
                >
                    {renderNetgetDock()}
                </div>
            </div>

            <div className={`netget-frame netget-frame--${mainView}`} aria-label="NetGet main view">
                {mainView === 'terminal' ? renderTerminal('main') : renderNetgetConsole()}
            </div>
        </div>
    );
};

export default WelcomeNetget;
