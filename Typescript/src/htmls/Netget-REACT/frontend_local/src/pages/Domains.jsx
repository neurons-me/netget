/* eslint-disable react/prop-types */
// Domains.jsx — local.netget domain routing table
// Shows all registered domain → target routes.
// Allows adding and deleting entries.
// Changes bump domain-map.version so Nginx routing hot-reloads.

import { useEffect, useState, useCallback, useMemo } from 'react';
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

async function fetchDomains() {
    const res = await fetch('/domains');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await parseJsonResponse(res);
    return Array.isArray(data.domains) ? data.domains : [];
}

async function addDomain({ domain, target, type, email }) {
    const res = await fetch('/add-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, target, type, email }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
}

async function provisionCert({ domain, email }) {
    const res = await fetch('/provision-cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, email }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? data.message ?? `${res.status}`);
    return data;
}

async function deleteDomain(domain) {
    const res = await fetch('/delete-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
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
function DomainRow({ row, session, provisioning, deleting, hasPublicCert, onEdit, onProvision, onDelete }) {
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
    return (
        <TableRow
            data-gui-node-id={nodeId}
            sx={{ '&:hover': { background: 'action.hover' } }}
        >
            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {row.domain}
            </TableCell>
            <TableCell data-gui-node-id={targetNodeId} sx={{ fontFamily: 'monospace', opacity: 0.7 }}>
                {row.target || '—'}
            </TableCell>
            <TableCell data-gui-node-id={typeNodeId}>
                <Chip
                    label={row.type || 'proxy'}
                    size="small"
                    variant="outlined"
                />
            </TableCell>
            <TableCell data-gui-node-id={sslNodeId}>
                <Chip
                    label={row.sslMode || 'none'}
                    size="small"
                    variant={row.sslMode && row.sslMode !== 'none' ? 'filled' : 'outlined'}
                    color={row.sslMode && row.sslMode !== 'none' ? 'success' : 'default'}
                />
            </TableCell>
            <TableCell align="right">
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
                <Tooltip title={`Delete ${row.domain}`}>
                    <span>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => onDelete(row.domain)}
                            disabled={deleting === row.domain}
                        >
                            {deleting === row.domain
                                ? <CircularProgress size={16} />
                                : <DeleteIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
            </TableCell>
        </TableRow>
    );
}

// ─── Add Domain Dialog ────────────────────────────────────────────────────────

const EMPTY_FORM = { domain: '', target: '', type: 'proxy', email: '' };

function AddDomainDialog({ open, onClose, onSuccess }) {
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
            setError('Domain is required.');
            return;
        }
        if ((form.type === 'server' || form.type === 'static') && !form.target.trim()) {
            setError('Target is required for server and static routes.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await addDomain(form);
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
            <DialogTitle>Add Domain Route</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                <TextField
                    label="Domain"
                    placeholder="api.suis-macbook-air.local"
                    helperText="The hostname this gateway should route."
                    value={form.domain}
                    onChange={(e) => setForm(f => ({ ...f, domain: e.target.value }))}
                    autoFocus
                    fullWidth
                />
                <TextField
                    label="Target"
                    placeholder="http://127.0.0.1:3001"
                    helperText="Optional for monad-resolved semantic surfaces; required for server/static routes."
                    value={form.target}
                    onChange={(e) => setForm(f => ({ ...f, target: e.target.value }))}
                    fullWidth
                />
                <TextField
                    label="Let's Encrypt Email"
                    placeholder="admin@example.com"
                    helperText="Optional now; required later when issuing a public certificate."
                    value={form.email}
                    onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                    fullWidth
                />
                <FormControl fullWidth size="small">
                    <InputLabel>Type</InputLabel>
                    <Select
                        label="Type"
                        value={form.type}
                        onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                    >
                        <MenuItem value="proxy">proxy</MenuItem>
                        <MenuItem value="static">static</MenuItem>
                        <MenuItem value="server">server</MenuItem>
                    </Select>
                </FormControl>
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={saving}
                    startIcon={saving ? <CircularProgress size={14} /> : <AddIcon />}
                >
                    {saving ? 'Adding…' : 'Add Route'}
                </Button>
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
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (domain) => {
        setDeleting(domain);
        setDeleteError(null);
        try {
            await deleteDomain(domain);
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
                            Registered domain → upstream routes. Changes hot-reload Nginx.
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
                            Add Route
                        </Button>
                    </Box>
                </Box>

                {descriptionNotice && (
                    <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDescriptionNotice(null)}>
                        {descriptionNotice}
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
                                    Add first route
                                </Button>
                            </Box>
                        ) : (
                            <TableContainer component={Paper} elevation={0}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, opacity: 0.55, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Domain</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, opacity: 0.55, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Target</TableCell>
                                            <TableCell sx={{ fontWeight: 700, opacity: 0.55, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Type</TableCell>
                                            <TableCell sx={{ fontWeight: 700, opacity: 0.55, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SSL</TableCell>
                                            <TableCell align="right" />
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {domains.map((row) => (
                                            <DomainRow
                                                key={row.domain}
                                                row={row}
                                                session={session}
                                                provisioning={provisioning}
                                                deleting={deleting}
                                                hasPublicCert={hasPublicCert}
                                                onEdit={setEditOpen}
                                                onProvision={setProvisionOpen}
                                                onDelete={handleDelete}
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
