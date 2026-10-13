/* eslint-disable react/prop-types */
// GatewayBar.jsx -- which gateway this screen is looking at, what it can ask of it and what it may change there.
//
// The gateways are this netget (always) and the ones the operator adds by an EXPLICIT address: no discovery. What is
// shown is what the gateway itself answered, each with how it was learned. A session belongs to ONE gateway and is only
// ever sent to it. Public CORS on a gateway's reads grants nothing: modifying needs that gateway's own authorization.
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
    IconButton, InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { LOCAL_ID, normalizeGatewayAddress } from '../../utils/gateways.js';

const STATE_CHIP = {
    ok: { label: 'Responde', color: 'success' },
    refused: { label: 'Rechazado', color: 'warning' },
    unreachable: { label: 'Inalcanzable / CORS', color: 'default' },
    error: { label: 'Error', color: 'error' },
};
const PERMISSION_CHIP = {
    yes: { label: 'Sí', color: 'success' },
    no: { label: 'No', color: 'default' },
    unknown: { label: 'Desconocido', color: 'default' },
};

function AddGatewayDialog({ open, onClose, onAdd }) {
    const [address, setAddress] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState(null);
    const checked = address.trim() ? normalizeGatewayAddress(address) : null;
    const close = () => { setAddress(''); setLabel(''); setError(null); onClose(); };
    const submit = () => {
        const result = onAdd(address, label);
        if (result.ok) close(); else setError(result.reason);
    };
    return (
        <Dialog open={open} onClose={close} maxWidth="sm" fullWidth data-gui-node-id="Gateways.addDialog">
            <DialogTitle>Agregar un gateway</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
                <TextField
                    label="Dirección"
                    placeholder="netget.site  ·  raspberrypi.local:3000  ·  http://192.168.1.40"
                    helperText={checked ? (checked.ok ? `Se consultará ${checked.origin}` : checked.reason) : 'La dirección explícita del gateway. No se descubre nada solo.'}
                    error={Boolean(checked && !checked.ok)}
                    value={address}
                    onChange={(e) => { setAddress(e.target.value); setError(null); }}
                    autoFocus
                    fullWidth
                />
                <TextField label="Nombre (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth size="small" />
                <Alert severity="info" sx={{ py: 0 }}>
                    Agregarlo solo permite <b>consultar lo que ese gateway divulga</b>. Administrarlo necesita una sesión que ese
                    gateway autorice.
                </Alert>
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Cancelar</Button>
                <Button variant="contained" startIcon={<AddIcon />} onClick={submit} disabled={!checked || !checked.ok}>Agregar</Button>
            </DialogActions>
        </Dialog>
    );
}

export default function GatewayBar({
    gateways, selectedId, onSelect, onAdd, onRemove, report, probing, onProbe, hasSession, onSaveSession,
}) {
    const [addOpen, setAddOpen] = useState(false);
    const [tokenDraft, setTokenDraft] = useState('');
    const gateway = gateways.find((g) => g.id === selectedId) || gateways[0];
    const perm = report?.permissions;

    return (
        <Box
            data-gui-node-id="Gateways.bar"
            data-gui-component="GatewayBar"
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, mb: 3 }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 240 }}>
                    <InputLabel>Gateway</InputLabel>
                    <Select label="Gateway" value={gateway.id} onChange={(e) => onSelect(e.target.value)} data-gui-node-id="Gateways.select">
                        {gateways.map((g) => (
                            <MenuItem key={g.id} value={g.id}>{g.label}{g.local ? '' : ` · ${g.display}`}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-gui-node-id="Gateways.add">Agregar gateway</Button>
                {!gateway.local && (
                    <Tooltip title="Quitar de la lista (también olvida su sesión)">
                        <IconButton size="small" onClick={() => onRemove(gateway.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Volver a preguntarle al gateway">
                    <span>
                        <IconButton size="small" onClick={onProbe} disabled={probing}>
                            {probing ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" sx={{ opacity: 0.6 }} data-gui-node-id="Gateways.viewing">
                    Estás viendo: <b>{gateway.label}</b> · <span style={{ fontFamily: 'monospace' }}>{gateway.local ? gateway.display : gateway.origin}</span>
                </Typography>
            </Box>

            {report && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mt: 2 }}>
                    <Box data-gui-node-id="Gateways.query">
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Qué puedo consultar</Typography>
                        <Table size="small">
                            <TableBody>
                                {report.reads.map((r) => {
                                    const chip = STATE_CHIP[r.state] || STATE_CHIP.error;
                                    return (
                                        <TableRow key={r.path}>
                                            <TableCell sx={{ border: 0, py: 0.25 }}>
                                                <Tooltip title={`${r.path} — ${r.detail}`}><span>{r.label}</span></Tooltip>
                                            </TableCell>
                                            <TableCell sx={{ border: 0, py: 0.25 }} align="right">
                                                <Chip size="small" label={chip.label} color={chip.color} variant={chip.color === 'default' ? 'outlined' : 'filled'} />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        {report.identity && (
                            <Typography variant="caption" sx={{ display: 'block', opacity: 0.65, mt: 0.5 }}>
                                {report.identity.hostname ? `${report.identity.hostname} · ` : ''}
                                {report.mainServerName ? `principal ${report.mainServerName} · ` : ''}
                                {report.namespace ? `namespace ${report.namespace} · ` : ''}
                                {report.version ? `v${report.version}` : ''}
                                {Array.isArray(report.domains) ? ` · ${report.domains.length} puerta(s) públicas` : ''}
                            </Typography>
                        )}
                        {report.reachable === 'unknown' && (
                            <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                                Estado desconocido: desde el navegador no se distingue «no hay nadie» de «CORS lo bloquea».
                            </Alert>
                        )}
                    </Box>

                    <Box data-gui-node-id="Gateways.modify">
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Qué puedo modificar</Typography>
                        {[['Leer su configuración', perm.readConfig], ['Modificar puertas', perm.modify]].map(([label, p]) => {
                            const chip = PERMISSION_CHIP[p.state] || PERMISSION_CHIP.unknown;
                            return (
                                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                    <Chip size="small" label={chip.label} color={chip.color} variant={chip.color === 'default' ? 'outlined' : 'filled'} sx={{ minWidth: 84 }} />
                                    <Tooltip title={p.basis}><Typography variant="body2">{label}</Typography></Tooltip>
                                </Box>
                            );
                        })}
                        <Typography variant="caption" sx={{ display: 'block', opacity: 0.65 }}>{perm.modify.basis}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                            <TextField
                                size="small"
                                type="password"
                                label={hasSession ? 'Sesión guardada para este gateway' : 'Sesión de administración de este gateway'}
                                value={tokenDraft}
                                onChange={(e) => setTokenDraft(e.target.value)}
                                placeholder={hasSession ? '••••••••' : 'la emite ese gateway'}
                                helperText="Se guarda solo para este gateway y solo se le envía a él."
                                sx={{ flex: 1 }}
                                inputProps={{ 'data-gui-node-id': 'Gateways.sessionInput', autoComplete: 'off' }}
                            />
                            <Button
                                size="small"
                                variant="outlined"
                                disabled={!tokenDraft.trim()}
                                onClick={() => { onSaveSession(tokenDraft); setTokenDraft(''); }}
                                data-gui-node-id="Gateways.sessionSave"
                            >
                                Usar
                            </Button>
                            {hasSession && <Button size="small" color="warning" onClick={() => onSaveSession('')}>Olvidar</Button>}
                        </Box>
                    </Box>
                </Box>
            )}

            <AddGatewayDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={onAdd} />
        </Box>
    );
}

export { LOCAL_ID };
