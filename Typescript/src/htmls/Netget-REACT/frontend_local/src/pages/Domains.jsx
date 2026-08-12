/* eslint-disable react/prop-types */
// Domains.jsx — local.netget domain routing table
// Shows all registered domain → target routes.
// Allows adding and deleting entries.
// Changes bump domain-map.version so Nginx routing hot-reloads.

import { useEffect, useState, useCallback } from 'react';
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
    Https as HttpsIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchDomains() {
    const res = await fetch('/domains');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    return Array.isArray(data.domains) ? data.domains : [];
}

async function addDomain({ domain, target, type, email }) {
    const res = await fetch('/add-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, target, type, email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
}

async function provisionCert({ domain, email }) {
    const res = await fetch('/provision-cert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? data.message ?? `${res.status}`);
    return data;
}

async function deleteDomain(domain) {
    const res = await fetch('/delete-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
}

// ─── Add Domain Dialog ────────────────────────────────────────────────────────

const EMPTY_FORM = { domain: '', target: '', type: 'proxy', email: '' };

function AddDomainDialog({ open, onClose, onSuccess }) {
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
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
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
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
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

// ─── Domains page ─────────────────────────────────────────────────────────────

export default function Domains() {
    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [addOpen, setAddOpen] = useState(false);
    const [deleting, setDeleting] = useState(null);   // domain string currently being deleted
    const [provisioning, setProvisioning] = useState(null);
    const [provisionOpen, setProvisionOpen] = useState(null);
    const [certNotice, setCertNotice] = useState(null);
    const [deleteError, setDeleteError] = useState(null);

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

    return (
        <>
            <Box sx={{ px: 3, py: 2, maxWidth: 1100, mx: 'auto' }}>

                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                    <Box>
                        <Typography variant="h5" fontWeight={700}>Domains</Typography>
                        <Typography variant="body2" sx={{ opacity: 0.5, mt: 0.25 }}>
                            Registered domain → upstream routes. Changes hot-reload Nginx.
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
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
                <Card variant="outlined">
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
                                            <TableRow
                                                key={row.domain}
                                                sx={{ '&:hover': { background: 'action.hover' } }}
                                            >
                                                <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                                    {row.domain}
                                                </TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', opacity: 0.7 }}>
                                                    {row.target || '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={row.type || 'proxy'}
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={row.sslMode || 'none'}
                                                        size="small"
                                                        variant={row.sslMode && row.sslMode !== 'none' ? 'filled' : 'outlined'}
                                                        color={row.sslMode && row.sslMode !== 'none' ? 'success' : 'default'}
                                                    />
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Tooltip title={`${hasPublicCert(row) ? 'Renew' : 'Provision'} Let's Encrypt certificate`}>
                                                        <span>
                                                            <IconButton
                                                                size="small"
                                                                color="primary"
                                                                onClick={() => setProvisionOpen(row)}
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
                                                                onClick={() => handleDelete(row.domain)}
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
        </>
    );
}
