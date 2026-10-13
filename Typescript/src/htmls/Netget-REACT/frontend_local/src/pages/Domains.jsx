/* eslint-disable react/prop-types */
// Domains.jsx — local.netget domain routing table
// Shows all registered domain → target routes.
// Allows adding and deleting entries.
// Changes bump domain-map.version so Nginx routing hot-reloads.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { isRefusal, refusalMessage } from '../utils/adminAccess.js';
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
    Alert,
    Paper,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
} from '@mui/material';
import {
    Add as AddIcon,
    Delete as DeleteIcon,
    Edit as EditIcon,
    Https as HttpsIcon,
    Lock as LockIcon,
    LockOpen as LockOpenIcon,
    Refresh as RefreshIcon,
    OpenInNew as OpenInNewIcon,
    SwapHoriz as SwapHorizIcon,
    LinkOff as LinkOffIcon,
} from '@mui/icons-material';
import { deriveCleakerNodeFromMe, fetchGatewayHostname, signedRequest } from 'this.gui/cleaker';
import { useRegisterGuiNode } from 'this.gui';
import { useOptionalSeedSessionContext } from 'this.gui/react';

// ─── API helpers ─────────────────────────────────────────────────────────────

// A non-JSON response (most often this dev server's own index.html, served
// for any path it doesn't recognize — see vite.config.js's proxy allowlist)
// makes a bare `res.json()` throw the raw "Unexpected token '<' ... is not
// valid JSON" browser parse error verbatim. That's the underlying failure
// mode, not this reporting it clearly — this names it instead.
async function parseJsonResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(
            `Expected JSON from ${res.url}, got "${contentType || 'unknown content-type'}" ` +
            `(HTTP ${res.status}). This route may not be reachable from this server.`
        );
    }
    return res.json();
}

// The full record (target, TLS files) is only for an admin session; without one /domains answers with the public
// projection (domain, type, subdomain, tls). The session is the one LogsView keeps in this key after signing.
const ADMIN_SESSION_STORAGE_KEY = 'netget:admin-session-token';
function adminAuthHeaders() {
    try {
        const token = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}

async function fetchDomains() {
    const res = await fetch('/domains', { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await parseJsonResponse(res);
    return Array.isArray(data.domains) ? data.domains : [];
}

async function addDomain({ domain, target, type, email }) {
    const res = await fetch('/add-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
        body: JSON.stringify({ domain, target, type, email }),
    });
    if (isRefusal(res)) throw new Error(refusalMessage('add-domain'));
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
}

async function provisionCert({ domain, email }) {
    const res = await fetch('/provision-cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
        body: JSON.stringify({ domain, email }),
    });
    if (isRefusal(res)) throw new Error(refusalMessage('provision-cert', { domain }));
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? data.message ?? `${res.status}`);
    return data;
}

async function deleteDomain(domain) {
    const res = await fetch('/delete-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
        body: JSON.stringify({ domain }),
    });
    if (isRefusal(res)) throw new Error(refusalMessage('delete-domain'));
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
}

// Changes where a door points. The same record: nothing is created, no identity, no namespace, no data copied.
async function updateDomainRoute({ domain, type, target }) {
    const res = await fetch('/update-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
        body: JSON.stringify({ domain, updatedFields: { type, target } }),
    });
    if (isRefusal(res)) throw new Error(refusalMessage('update-domain'));
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
}

// The apps registered with this gateway (live ones), to point a door at by name.
async function fetchApps() {
    const res = await fetch('/apps', { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await parseJsonResponse(res);
    return (Array.isArray(data.apps) ? data.apps : []).map((app) => ({
        name: String(app?.metadata?.monadName || String(app?.name || '').replace(/^monad:/, '')),
        port: app?.port,
    })).filter((app) => app.name);
}

// What each door is doing now (destination answers? certificate? applied?). Admin-only on the gateway. When it cannot
// be had the panel says "unknown": it never invents a state.
async function fetchStatuses() {
    const res = await fetch('/domains/status', { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await parseJsonResponse(res);
    const byDomain = {};
    for (const entry of Array.isArray(data.statuses) ? data.statuses : []) byDomain[entry.domain] = entry;
    return byDomain;
}

// Capability-gated — requires an unlocked .me signing session. Whatever the
// server answers (200, 403 CAPABILITY_DENIED, 401, ...) is surfaced verbatim;
// this function does not interpret grants or decide anything on its own.
async function editDomainMetadata(session, domain, description) {
    const res = await signedRequest(session.node, session.hostname, '/domains/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, description }),
    });
    if (isRefusal(res)) throw new Error(refusalMessage('domain-metadata'));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const detail = data.error ?? `${res.status}`;
        throw new Error(data.required ? `${detail} — required: ${data.required}` : detail);
    }
    return data;
}

// ─── Domain table row ───────────────────────────────────────────────────────
// Extracted so it can call useRegisterGuiNode individually — hooks can't
// live inside domains.map() directly (same reasoning as WelcomeNetget.jsx's
// TerminalLine/PortChip/SurfaceRow). `row.semanticPath` comes straight from
// domainStore.ts's toDomainRecord() — already the real, fully-qualified
// kernel path (users.<owner>.domains.<key>), so Explain works against real
// data with zero owner/escaping logic duplicated here.
// What a door can point at (mirrors src/runtime/routeTargets.ts, which is the one the gateway enforces).
const DESTINATION_KINDS = [
    { kind: 'app', label: 'App registrada', type: 'server', hint: 'Una app registrada en este gateway: hereda su política de exposición y autorización.' },
    { kind: 'server', label: 'Servicio en un puerto', type: 'server', hint: 'Un servicio HTTP en host:puerto (esta máquina u otra de la red). Por TLS (https://) todavía no.' },
    { kind: 'static', label: 'Carpeta de archivos', type: 'static', hint: 'Una carpeta absoluta que tenga index.html.' },
    { kind: 'proxy', label: 'Superficie del monad', type: 'proxy', hint: 'La resuelve el monad de este gateway; sin destino.' },
];

function destinationOfRow(row) {
    const type = String(row?.type || 'proxy').toLowerCase();
    const target = String(row?.target || '');
    if (type === 'static') return { kind: 'static', app: '', hostport: '', folder: target };
    if (/^app:/i.test(target)) return { kind: 'app', app: target.slice(4), hostport: '', folder: '' };
    if (type === 'server' || target) return { kind: 'server', app: '', hostport: target, folder: '' };
    return { kind: 'proxy', app: '', hostport: '', folder: '' };
}

// -> { type, target } or { error }. The gateway checks it again: this only says what is missing before asking.
function destinationFields(dest) {
    if (dest.kind === 'app') return dest.app ? { type: 'server', target: `app:${dest.app}` } : { error: 'Elige una app.' };
    if (dest.kind === 'server') return dest.hostport.trim() ? { type: 'server', target: dest.hostport.trim() } : { error: 'Escribe host:puerto.' };
    if (dest.kind === 'static') return dest.folder.trim() ? { type: 'static', target: dest.folder.trim() } : { error: 'Escribe la ruta absoluta de la carpeta.' };
    return { type: 'proxy', target: '' };
}

function DestinationPicker({ value, onChange, apps, appsError }) {
    const kind = DESTINATION_KINDS.find((k) => k.kind === value.kind) || DESTINATION_KINDS[1];
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-gui-node-id="Domains.destinationPicker">
            <FormControl fullWidth size="small">
                <InputLabel>Destino</InputLabel>
                <Select label="Destino" value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value })}>
                    {DESTINATION_KINDS.map((k) => <MenuItem key={k.kind} value={k.kind}>{k.label}</MenuItem>)}
                </Select>
            </FormControl>
            {value.kind === 'app' && (
                apps.length > 0 ? (
                    <FormControl fullWidth size="small">
                        <InputLabel>App</InputLabel>
                        <Select label="App" value={value.app} onChange={(e) => onChange({ ...value, app: e.target.value })}>
                            {apps.map((a) => <MenuItem key={a.name} value={a.name}>{a.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                ) : (
                    <TextField
                        label="App"
                        placeholder="fulltrailer"
                        value={value.app}
                        onChange={(e) => onChange({ ...value, app: e.target.value.trim() })}
                        helperText={appsError
                            ? `No se pudo leer el registro de apps (${appsError}). Puedes escribir el nombre; el estado dirá si está viva.`
                            : 'No hay apps vivas registradas ahora. Puedes escribir el nombre; el estado dirá si está viva.'}
                        size="small"
                        fullWidth
                    />
                )
            )}
            {value.kind === 'server' && (
                <TextField label="Servicio" placeholder="127.0.0.1:4000" value={value.hostport}
                    onChange={(e) => onChange({ ...value, hostport: e.target.value })} size="small" fullWidth />
            )}
            {value.kind === 'static' && (
                <TextField label="Carpeta" placeholder="/Users/yo/mi-sitio/dist" value={value.folder}
                    onChange={(e) => onChange({ ...value, folder: e.target.value })} size="small" fullWidth />
            )}
            <Typography variant="caption" sx={{ opacity: 0.6 }}>{kind.hint}</Typography>
        </Box>
    );
}

// The chips that say what a door is doing. "Estado desconocido" is a state: it is shown when the gateway could not say.
function destinationChip(status) {
    if (!status) return { label: 'Estado desconocido', color: 'default', tip: 'El gateway no pudo decir el estado de esta puerta.' };
    const state = status.destination?.state;
    const tip = status.destination?.detail || '';
    if (state === 'ok') return { label: 'Responde', color: 'success', tip };
    if (state === 'down') return { label: 'No responde', color: 'error', tip };
    if (state === 'missing') return { label: 'Falta el destino', color: 'error', tip };
    return { label: 'Estado desconocido', color: 'default', tip: tip || 'No se pudo comprobar.' };
}

function DomainRow({ row, status, session, provisioning, deleting, hasPublicCert, onEdit, onProvision, onChangeDestination, onDisconnect }) {
    const nodeId = `Domains.row.${row.domain}`;
    useRegisterGuiNode(nodeId, 'DomainRow', 'Domains.routesCard', { semanticPath: row.semanticPath });
    // Per-field registration — the row's own semanticPath points at the whole
    // record (no single scalar to explain there); each field's real value
    // lives one level deeper (`<record>.target`, `.type`, `.sslMode`), so
    // Explain only resolves to something meaningful when pointed at the
    // field itself, not the row as a whole.
    const targetNodeId = `${nodeId}.target`;
    const typeNodeId = `${nodeId}.type`;
    const sslNodeId = `${nodeId}.sslMode`;
    useRegisterGuiNode(targetNodeId, 'DomainField', nodeId, row.semanticPath ? { semanticPath: `${row.semanticPath}.target` } : undefined);
    useRegisterGuiNode(typeNodeId, 'DomainField', nodeId, row.semanticPath ? { semanticPath: `${row.semanticPath}.type` } : undefined);
    useRegisterGuiNode(sslNodeId, 'DomainField', nodeId, row.semanticPath ? { semanticPath: `${row.semanticPath}.sslMode` } : undefined);

    const dest = destinationChip(status);
    const tlsKnown = !!status?.tls;
    const tlsPending = tlsKnown && status.tls.state === 'pending';
    const openUrl = status?.open?.url || null;
    const openWhy = status ? (status.open?.why || 'No se puede abrir todavía') : 'Estado desconocido: no se sabe si abre';
    return (
        <TableRow
            data-gui-node-id={nodeId}
            sx={{ '&:hover': { background: 'action.hover' } }}
        >
            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {row.domain}
            </TableCell>
            <TableCell data-gui-node-id={targetNodeId} sx={{ fontFamily: 'monospace', opacity: 0.7 }}>
                {/* the listing is the public projection without a read grant; the status (admin-only) carries it */}
                {row.target || status?.target || '—'}
            </TableCell>
            <TableCell data-gui-node-id={typeNodeId}>
                <Chip
                    label={row.type || 'proxy'}
                    size="small"
                    variant="outlined"
                />
            </TableCell>
            <TableCell data-gui-node-id={sslNodeId}>
                <Tooltip title={tlsKnown ? status.tls.detail : (row.sslMode && row.sslMode !== 'none' ? `Modo: ${row.sslMode}` : 'Estado de TLS desconocido')}>
                    <span>
                        <Chip
                            label={tlsKnown ? (tlsPending ? 'TLS pendiente' : 'TLS configurado') : (row.sslMode || 'none')}
                            size="small"
                            variant={tlsKnown && !tlsPending ? 'filled' : 'outlined'}
                            color={tlsKnown ? (tlsPending ? 'warning' : 'success') : 'default'}
                        />
                    </span>
                </Tooltip>
            </TableCell>
            <TableCell data-gui-node-id={`${nodeId}.state`}>
                <Tooltip title={dest.tip}>
                    <span>
                        <Chip label={dest.label} size="small" color={dest.color} variant={dest.color === 'default' ? 'outlined' : 'filled'} />
                    </span>
                </Tooltip>
                {status && status.applied === false && (
                    <Tooltip title="El registro existe pero el router no lo ha cargado todavía.">
                        <span><Chip label="No aplicada" size="small" color="warning" variant="outlined" sx={{ ml: 0.5 }} /></span>
                    </Tooltip>
                )}
            </TableCell>
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <Tooltip title={openUrl ? `Abrir ${openUrl}` : openWhy}>
                    <span>
                        <IconButton
                            size="small"
                            disabled={!openUrl}
                            onClick={() => window.open(openUrl, '_blank', 'noopener')}
                            data-gui-node-id={`${nodeId}.open`}
                        >
                            <OpenInNewIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Cambiar destino">
                    <span>
                        <IconButton
                            size="small"
                            onClick={() => onChangeDestination({ ...row, target: row.target || status?.target || '', type: row.type || status?.type })}
                            disabled={deleting === row.domain}
                            data-gui-node-id={`${nodeId}.change`}
                        >
                            <SwapHorizIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={session ? 'Edit description' : 'Unlock .me proof to attempt this'}>
                    <span>
                        <IconButton
                            size="small"
                            onClick={() => onEdit(row)}
                            disabled={!session}
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={`${hasPublicCert(row) ? 'Renew' : 'Provision'} Let's Encrypt certificate`}>
                    <span>
                        <IconButton
                            size="small"
                            color="primary"
                            onClick={() => onProvision(row)}
                            disabled={provisioning === row.domain || deleting === row.domain}
                        >
                            {provisioning === row.domain
                                ? <CircularProgress size={16} />
                                : <HttpsIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={`Desconectar ${row.domain} (no borra archivos ni detiene la app)`}>
                    <span>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => onDisconnect({ ...row, target: row.target || status?.target || '' })}
                            disabled={deleting === row.domain}
                            data-gui-node-id={`${nodeId}.disconnect`}
                        >
                            {deleting === row.domain
                                ? <CircularProgress size={16} />
                                : <LinkOffIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
            </TableCell>
        </TableRow>
    );
}

// ─── Add Domain Dialog ────────────────────────────────────────────────

const EMPTY_DEST = { kind: 'server', app: '', hostport: '', folder: '' };
const EMPTY_FORM = { domain: '', dest: EMPTY_DEST, email: '' };

function AddDomainDialog({ open, onClose, onSuccess, apps, appsError }) {
    useRegisterGuiNode('Domains.addDialog', 'AddDomainDialog');
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const handleClose = () => {
        setForm(EMPTY_FORM);
        setError(null);
        onClose();
    };

    const handleSubmit = async () => {
        if (!form.domain.trim()) {
            setError('El dominio es obligatorio.');
            return;
        }
        const fields = destinationFields(form.dest);
        if (fields.error) {
            setError(fields.error);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await addDomain({ domain: form.domain.trim(), type: fields.type, target: fields.target, email: form.email });
            setForm(EMPTY_FORM);
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            data-gui-node-id="Domains.addDialog"
            data-gui-component="AddDomainDialog"
        >
            <DialogTitle>Conectar una puerta</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                <TextField
                    label="Dominio"
                    placeholder="api.suis-macbook-air.local"
                    helperText="El nombre que este gateway debe enrutar."
                    value={form.domain}
                    onChange={(e) => setForm(f => ({ ...f, domain: e.target.value }))}
                    autoFocus
                    fullWidth
                />
                <DestinationPicker
                    value={form.dest}
                    onChange={(dest) => setForm(f => ({ ...f, dest }))}
                    apps={apps}
                    appsError={appsError}
                />
                <TextField
                    label="Let's Encrypt Email"
                    placeholder="admin@example.com"
                    helperText="Opcional ahora; hace falta al pedir un certificado público."
                    value={form.email}
                    onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                    fullWidth
                />
                <Alert severity="info" sx={{ py: 0 }}>
                    Sin certificado, la puerta queda con <b>TLS pendiente</b>: no abre por HTTPS hasta que se aprovisione uno.
                </Alert>
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>Cancelar</Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={saving}
                    startIcon={saving ? <CircularProgress size={14} /> : <AddIcon />}
                >
                    {saving ? 'Conectando…' : 'Conectar'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ─── Change destination ─────────────────────────────────────────────────

function ChangeDestinationDialog({ row, open, onClose, onSuccess, apps, appsError }) {
    useRegisterGuiNode('Domains.changeDialog', 'ChangeDestinationDialog');
    const [dest, setDest] = useState(EMPTY_DEST);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { if (row) { setDest(destinationOfRow(row)); setError(null); } }, [row]);

    const handleSubmit = async () => {
        const fields = destinationFields(dest);
        if (fields.error) { setError(fields.error); return; }
        setSaving(true);
        setError(null);
        try {
            await updateDomainRoute({ domain: row.domain, type: fields.type, target: fields.target });
            onSuccess(row.domain);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-gui-node-id="Domains.changeDialog" data-gui-component="ChangeDestinationDialog">
            <DialogTitle>Cambiar destino de {row?.domain}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                    Es el mismo registro: no se crea otra identidad ni se copian datos. Ahora apunta a{' '}
                    <b style={{ fontFamily: 'monospace' }}>{row?.target || '—'}</b>.
                </Typography>
                <DestinationPicker value={dest} onChange={setDest} apps={apps} appsError={appsError} />
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button variant="contained" onClick={handleSubmit} disabled={saving}
                    startIcon={saving ? <CircularProgress size={14} /> : <SwapHorizIcon />}>
                    {saving ? 'Cambiando…' : 'Cambiar destino'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ─── Disconnect ─────────────────────────────────────────────────────────

function DisconnectDialog({ row, open, onClose, onConfirm }) {
    useRegisterGuiNode('Domains.disconnectDialog', 'DisconnectDialog');
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-gui-node-id="Domains.disconnectDialog" data-gui-component="DisconnectDialog">
            <DialogTitle>Desconectar {row?.domain}</DialogTitle>
            <DialogContent>
                <Typography variant="body2">
                    La puerta deja de existir: el dominio ya no abre. <b>No se borran archivos ni se detiene la app</b> a la que apuntaba
                    ({row?.target || 'sin destino'}); solo desaparece esta conexión.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancelar</Button>
                <Button color="error" variant="contained" onClick={() => onConfirm(row.domain)} startIcon={<LinkOffIcon />}>Desconectar</Button>
            </DialogActions>
        </Dialog>
    );
}

// ─── Provision Certificate Dialog ─────────────────────────────────────────────

function hasPublicCert(row) {
    const mode = String(row?.sslMode || '').trim().toLowerCase();
    return !!mode && mode !== 'none' && mode !== 'off';
}

function ProvisionCertDialog({ row, open, onClose, onSuccess }) {
    useRegisterGuiNode('Domains.provisionDialog', 'ProvisionCertDialog');
    const [email, setEmail] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setEmail(String(row?.email || '').trim());
            setError(null);
        }
    }, [open, row]);

    const handleClose = () => {
        if (saving) return;
        setError(null);
        onClose();
    };

    const handleSubmit = async () => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) {
            setError('Email is required for Let’s Encrypt.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await provisionCert({ domain: row.domain, email: trimmedEmail });
            await onSuccess(row.domain);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            data-gui-node-id="Domains.provisionDialog"
            data-gui-component="ProvisionCertDialog"
        >
            <DialogTitle>
                {hasPublicCert(row) ? 'Renew Certificate' : 'Provision Certificate'}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                <Typography variant="body2" sx={{ opacity: 0.65 }}>
                    {row?.domain}
                </Typography>
                <TextField
                    label="Let's Encrypt Email"
                    placeholder="admin@example.com"
                    helperText="Used by Let’s Encrypt for expiry and account notices."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    fullWidth
                />
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={saving}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={saving}
                    startIcon={saving ? <CircularProgress size={14} /> : <HttpsIcon />}
                >
                    {saving ? 'Provisioning…' : hasPublicCert(row) ? 'Renew Cert' : 'Provision Cert'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ─── Edit Description Dialog ──────────────────────────────────────────────────
// Calls the one capability-gated write this page knows about. Whatever the
// server answers is shown as-is — no local guess at whether it'll succeed.

function EditDescriptionDialog({ row, open, onClose, onSuccess, session }) {
    useRegisterGuiNode('Domains.editDialog', 'EditDescriptionDialog');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setDescription('');
            setError(null);
        }
    }, [open]);

    const handleClose = () => {
        if (saving) return;
        setError(null);
        onClose();
    };

    const handleSubmit = async () => {
        setSaving(true);
        setError(null);
        try {
            const data = await editDomainMetadata(session, row.domain, description);
            await onSuccess(data.description);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            data-gui-node-id="Domains.editDialog"
            data-gui-component="EditDescriptionDialog"
        >
            <DialogTitle>Edit Description</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                <Typography variant="body2" sx={{ opacity: 0.65 }}>
                    {row?.domain}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.5 }}>
                    Not shown in the table below yet — this writes to a separate metadata record,
                    read-back display is a follow-up.
                </Typography>
                <TextField
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    autoFocus
                    fullWidth
                    multiline
                    minRows={2}
                />
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={saving}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={saving}
                    startIcon={saving ? <CircularProgress size={14} /> : <EditIcon />}
                >
                    {saving ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ─── Domains page ─────────────────────────────────────────────────────────────

export default function Domains() {
    useRegisterGuiNode('Domains.header', 'DomainsHeader');
    useRegisterGuiNode('Domains.sessionControl', 'DomainsSessionControl', 'Domains.header');
    useRegisterGuiNode('Domains.routesCard', 'DomainsRoutesCard');
    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [addOpen, setAddOpen] = useState(false);
    const [deleting, setDeleting] = useState(null);   // domain string currently being deleted
    const [provisioning, setProvisioning] = useState(null);
    const [provisionOpen, setProvisionOpen] = useState(null);
    const [certNotice, setCertNotice] = useState(null);
    const [deleteError, setDeleteError] = useState(null);
    const [editOpen, setEditOpen] = useState(null);         // row currently being edited
    const [descriptionNotice, setDescriptionNotice] = useState(null);
    const [statuses, setStatuses] = useState({});            // domain -> what the gateway says it is doing
    const [statusError, setStatusError] = useState(null);    // why the states are unknown, when they are
    const [apps, setApps] = useState([]);
    const [appsError, setAppsError] = useState(null);
    const [changeOpen, setChangeOpen] = useState(null);      // row whose destination is being changed
    const [disconnectOpen, setDisconnectOpen] = useState(null);
    const [notice, setNotice] = useState(null);

    // The .me session lives in MeLauncher (sidebar bubble) now — this page
    // just reads it. candidateSession.node/hostname are re-derived from the
    // shared session's own `me` kernel instance (deriveCleakerNodeFromMe),
    // not a second independent identity: same seed, same cleaker binding
    // UnlockDialog used to compute locally, see docs/wild-bubbling-lemon.
    //
    // A monad claim/open success only proves identity (A) — it says nothing
    // about whether this gateway's own gateway-claims.json (a completely
    // separate store — "the jewel", see EncryptedAudienceCapabilityTests)
    // has ever heard of this identity or granted it anything (C). Gating
    // "Unlocked"/edit-capability on the monad session alone (without this
    // verify step) would show a false-positive Unlocked chip for any seed
    // that can open a monad session but was never registered as a gateway
    // admin — the real /domains/metadata write would still 403 server-side,
    // but the UI would have claimed otherwise. So: still call /check-auth
    // once, same as UnlockDialog always did, just with the session-derived
    // node instead of a freshly-typed one.
    const seedCtx = useOptionalSeedSessionContext();
    const [gatewayHostname, setGatewayHostname] = useState(null);
    useEffect(() => {
        fetchGatewayHostname().then(setGatewayHostname).catch(() => {});
    }, []);
    const candidateSession = useMemo(() => {
        if (!seedCtx?.authenticated || !seedCtx.me || !gatewayHostname) return null;
        return {
            node: deriveCleakerNodeFromMe(seedCtx.me, gatewayHostname),
            hostname: gatewayHostname,
            identityHash: seedCtx.identityHash || '',
        };
    }, [seedCtx?.authenticated, seedCtx?.me, seedCtx?.identityHash, gatewayHostname]);

    // null = no session / not checked yet, 'checking' = /check-auth in
    // flight, true = verified, false = checked and rejected (distinct from
    // 'checking' — collapsing these looked identical in the header chip,
    // which got stuck on "Verifying…" forever for a real 401).
    const [verified, setVerified] = useState(null);
    useEffect(() => {
        if (!candidateSession) { setVerified(null); return undefined; }
        let cancelled = false;
        setVerified('checking');
        signedRequest(candidateSession.node, candidateSession.hostname, '/check-auth')
            .then((res) => res.json().catch(() => ({})))
            .then((data) => { if (!cancelled) setVerified(!!data.authenticated); })
            .catch(() => { if (!cancelled) setVerified(false); });
        return () => { cancelled = true; };
    }, [candidateSession]);

    const session = verified === true ? candidateSession : null;

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setDomains(await fetchDomains());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
        // States and the apps to choose from are separate reads: when they fail the panel says "unknown", it does not
        // pretend, and the routes are still listed.
        try { setStatuses(await fetchStatuses()); setStatusError(null); } catch (err) { setStatuses({}); setStatusError(err.message); }
        try { setApps(await fetchApps()); setAppsError(null); } catch (err) { setApps([]); setAppsError(err.message); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (domain) => {
        setDisconnectOpen(null);
        setDeleting(domain);
        setDeleteError(null);
        try {
            await deleteDomain(domain);
            setNotice(`${domain} desconectado. Sus archivos y la app a la que apuntaba siguen donde estaban.`);
            await load();
        } catch (err) {
            setDeleteError(err.message);
        } finally {
            setDeleting(null);
        }
    };

    const handleCertProvisioned = async (domain) => {
        setProvisioning(domain);
        setCertNotice(null);
        try {
            await load();
            setCertNotice(`Certificate updated for ${domain}.`);
        } finally {
            setProvisioning(null);
        }
    };

    const handleDestinationChanged = async (domain) => {
        setNotice(`${domain} apunta a otro destino. Es el mismo registro; no se creó nada nuevo.`);
        await load();
    };

    const handleDescriptionSaved = async (description) => {
        setDescriptionNotice(`Description saved: "${description}"`);
    };

    return (
        <>
            <Box sx={{ px: 3, py: 2, maxWidth: 1100, mx: 'auto' }}>

                {/* Header */}
                <Box
                    data-gui-node-id="Domains.header"
                    data-gui-component="DomainsHeader"
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
                >
                    <Box>
                        <Typography variant="h5" fontWeight={700}>Domains</Typography>
                        <Typography variant="body2" sx={{ opacity: 0.5, mt: 0.25 }}>
                            Puertas: dominio → destino (app registrada, servicio en un puerto o carpeta). Los cambios se aplican al router en caliente.
                        </Typography>
                    </Box>
                    <Box
                        data-gui-node-id="Domains.sessionControl"
                        data-gui-component="DomainsSessionControl"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        {session ? (
                            <Tooltip title={`Unlocked — ${session.identityHash ? session.identityHash.slice(0, 12) : 'identity'}… Signing key stays in memory for this tab only.`}>
                                <Chip
                                    size="small"
                                    icon={<LockOpenIcon fontSize="small" />}
                                    label="Unlocked"
                                    variant="outlined"
                                    color="success"
                                    onDelete={() => seedCtx?.logout()}
                                    deleteIcon={<LockIcon fontSize="small" />}
                                />
                            </Tooltip>
                        ) : verified === 'checking' ? (
                            <Chip size="small" icon={<LockIcon fontSize="small" />} label="Verifying…" variant="outlined" />
                        ) : verified === false && candidateSession ? (
                            <Tooltip title="This .me identity has no capability grant on this gateway (gateway-claims.json). Reads still work; writes will 403.">
                                <Chip size="small" icon={<LockIcon fontSize="small" />} label="Not registered" variant="outlined" color="warning" />
                            </Tooltip>
                        ) : (
                            <Tooltip title="Use the .me bubble in the sidebar to unlock a signing session.">
                                <Chip
                                    size="small"
                                    icon={<LockIcon fontSize="small" />}
                                    label="Locked"
                                    variant="outlined"
                                />
                            </Tooltip>
                        )}
                        <Tooltip title="Refresh">
                            <IconButton onClick={load} disabled={loading}>
                                <RefreshIcon />
                            </IconButton>
                        </Tooltip>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => setAddOpen(true)}
                        >
                            Conectar puerta
                        </Button>
                    </Box>
                </Box>

                {descriptionNotice && (
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDescriptionNotice(null)}>
                        {descriptionNotice}
                    </Alert>
                )}

                {notice && (
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
                        {notice}
                    </Alert>
                )}

                {statusError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Estado desconocido: el gateway no devolvió el estado de las puertas ({statusError}). Las rutas se listan,
                        pero no se sabe si responden ni si su TLS está configurado.
                    </Alert>
                )}

                {deleteError && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
                        {deleteError}
                    </Alert>
                )}

                {certNotice && (
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCertNotice(null)}>
                        {certNotice}
                    </Alert>
                )}

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                {/* Table */}
                <Card
                    variant="outlined"
                    data-gui-node-id="Domains.routesCard"
                    data-gui-component="DomainsRoutesCard"
                >
                    <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                        {loading && domains.length === 0 ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                                <CircularProgress size={28} />
                            </Box>
                        ) : domains.length === 0 ? (
                            <Box sx={{ textAlign: 'center', py: 8 }}>
                                <Typography variant="body1" sx={{ opacity: 0.45, mb: 2 }}>
                                    No domain routes registered.
                                </Typography>
                                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                                    Conectar la primera puerta
                                </Button>
                            </Box>
                        ) : (
                            <TableContainer component={Paper} elevation={0}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            {['Dominio', 'Destino', 'Tipo', 'TLS', 'Estado'].map((h) => (
                                                <TableCell key={h} sx={{ fontWeight: 700, opacity: 0.55, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</TableCell>
                                            ))}
                                            <TableCell align="right" />
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {domains.map((row) => (
                                            <DomainRow
                                                key={row.domain}
                                                row={row}
                                                status={statusError ? undefined : statuses[row.domain]}
                                                session={session}
                                                provisioning={provisioning}
                                                deleting={deleting}
                                                hasPublicCert={hasPublicCert}
                                                onEdit={setEditOpen}
                                                onProvision={setProvisionOpen}
                                                onChangeDestination={setChangeOpen}
                                                onDisconnect={setDisconnectOpen}
                                            />
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </CardContent>
                </Card>

                <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.3 }}>
                    {domains.length} route{domains.length !== 1 ? 's' : ''} · routes go live after Nginx hot-reload
                </Typography>
            </Box>

            <AddDomainDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onSuccess={load}
                apps={apps}
                appsError={appsError}
            />
            <ChangeDestinationDialog
                row={changeOpen}
                open={!!changeOpen}
                onClose={() => setChangeOpen(null)}
                onSuccess={handleDestinationChanged}
                apps={apps}
                appsError={appsError}
            />
            <DisconnectDialog
                row={disconnectOpen}
                open={!!disconnectOpen}
                onClose={() => setDisconnectOpen(null)}
                onConfirm={handleDelete}
            />
            <ProvisionCertDialog
                row={provisionOpen}
                open={!!provisionOpen}
                onClose={() => setProvisionOpen(null)}
                onSuccess={handleCertProvisioned}
            />
            <EditDescriptionDialog
                row={editOpen}
                open={!!editOpen}
                onClose={() => setEditOpen(null)}
                onSuccess={handleDescriptionSaved}
                session={session}
            />
        </>
    );
}
