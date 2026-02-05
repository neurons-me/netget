import React, { useEffect, useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Paper,
    Chip,
    Button,
    Divider,
    Grid,
    Alert,
    CircularProgress,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableRow,
    Modal,
    TextField,
    MenuItem,
    FormControl,
    InputLabel,
    Select,
    Snackbar
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
    ArrowBack as ArrowBackIcon,
    ContentCopy as ContentCopyIcon,
    Edit as EditIcon,
    Security as SecurityIcon,
    Language as LanguageIcon,
    Person as PersonIcon,
    Storage as StorageIcon,
    Save as SaveIcon,
    Close as CloseIcon,
    Article as ArticleIcon
} from '@mui/icons-material';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import NetGetAppBar from '../components/AppBar/NetGetAppBar.jsx';
import Footer from '../components/Footer/Footer.jsx';

const domains_route = import.meta.env.VITE_API_URL || "http://localhost:3000";

const DomainDetail = () => {
    const navigate = useNavigate();
    const { domainName } = useParams();
    const location = useLocation();
    const [domainData, setDomainData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [copySuccess, setCopySuccess] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editFormData, setEditFormData] = useState({});
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [snackbarMessage, setSnackbarMessage] = useState('');
    const [snackbarSeverity, setSnackbarSeverity] = useState('success');
    const [subdomains, setSubdomains] = useState([]);
    const [subdomainsLoading, setSubdomainsLoading] = useState(false);

    useEffect(() => {
        // Get domain data from navigation state or fetch it
        if (location.state && location.state.domainData) {
            setDomainData(location.state.domainData);
            setLoading(false);
        } else if (domainName) {
            fetchDomainData();
        } else {
            navigate('/');
        }
    }, [domainName, location, navigate]);

    // Fetch subdomains when domainData is loaded
    useEffect(() => {
        if (domainData) {
            fetchSubdomains();
        }
    }, [domainData]);

    const fetchDomainData = async () => {
        try {
            setLoading(true);
            const response = await fetch(`${domains_route}/domains`, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    window.location.href = '/login';
                    return;
                }
                throw new Error('Failed to fetch domain data');
            }

            const domains = await response.json();
            const domain = domains.find(d => d.domain === domainName);
            
            if (!domain) {
                setError('Domain not found');
                return;
            }

            setDomainData(domain);
        } catch (err) {
            console.error('Error fetching domain data:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchSubdomains = async () => {
        if (!domainData?.domain) return;
        
        try {
            setSubdomainsLoading(true);
            const response = await fetch(`${domains_route}/domains/${domainData.domain}/subdomains`, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    window.location.href = '/login';
                    return;
                }
                throw new Error('Failed to fetch subdomains');
            }

            const subdomainsData = await response.json();
            // Sort subdomains alphabetically by domain name
            subdomainsData.sort((a, b) => a.domain.localeCompare(b.domain));
            setSubdomains(subdomainsData);
        } catch (err) {
            console.error('Error fetching subdomains:', err);
        } finally {
            setSubdomainsLoading(false);
        }
    };

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    const handleEditDomain = () => {
        setEditFormData({ ...domainData });
        setEditModalOpen(true);
    };

    const handleEditFormChange = (field, value) => {
        setEditFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleSaveDomain = async () => {
        try {
            const { domain, ...updatedFields } = editFormData;
            
            const response = await fetch(`${domains_route}/update-domain`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ domain: domainData.domain, updatedFields }),
            });

            if (response.ok) {
                setDomainData(editFormData);
                setEditModalOpen(false);
                setSnackbarMessage('Domain updated successfully!');
                setSnackbarSeverity('success');
                setSnackbarOpen(true);
            } else {
                throw new Error('Failed to update domain.');
            }
        } catch (error) {
            console.error('Error updating domain:', error);
            setSnackbarMessage('Error updating domain.');
            setSnackbarSeverity('error');
            setSnackbarOpen(true);
        }
    };

    const handleCloseEditModal = () => {
        setEditModalOpen(false);
        setEditFormData({});
    };

    const handleViewDomainLogs = () => {
        // Navigate to logs page with domain filter
        navigate('/logs', {
            state: {
                domainFilter: domainData.domain,
                filterType: 'domain'
            }
        });
    };

    const getSSLModeColor = (sslMode) => {
        switch (sslMode?.toLowerCase()) {
            case 'letsencrypt':
                return 'success';
            case 'manual':
                return 'warning';
            case 'disabled':
                return 'error';
            default:
                return 'default';
        }
    };

    const getTypeColor = (type) => {
        switch (type?.toLowerCase()) {
            case 'server':
                return 'primary';
            case 'static':
                return 'info';
            case 'redirect':
                return 'warning';
            default:
                return 'default';
        }
    };

    if (loading) {
        return (
            <>
                <NetGetAppBar />
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
                    <CircularProgress />
                </Box>
            </>
        );
    }

    if (error) {
        return (
            <>
                <NetGetAppBar />
                <Box sx={{ px: 2, py: 2, mt: 8 }}>
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                    <Button
                        variant="outlined"
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/')}
                    >
                        Back to Domains
                    </Button>
                </Box>
            </>
        );
    }

    if (!domainData) {
        return (
            <>
                <NetGetAppBar />
                <Box sx={{ px: 2, py: 2, mt: 8 }}>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Domain not found
                    </Alert>
                    <Button
                        variant="outlined"
                        startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/')}
                    >
                        Back to Domains
                    </Button>
                </Box>
            </>
        );
    }

    return (
        <>
            <NetGetAppBar />
            <Box sx={{ px: 2, py: 2, mt: 8 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={<ArrowBackIcon />}
                            onClick={() => navigate('/home')}
                        >
                            Back to Domains
                        </Button>
                        <Box>
                            <Typography variant="h4" component="h1">
                                {domainData.domain}
                            </Typography>
                            <Typography variant="subtitle1" color="text.secondary">
                                Domain Configuration Details
                            </Typography>
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="outlined"
                            startIcon={<ArticleIcon />}
                            onClick={handleViewDomainLogs}
                        >
                            View Domain Logs
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<ContentCopyIcon />}
                            onClick={() => copyToClipboard(domainData.domain)}
                        >
                            Copy Domain
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={<EditIcon />}
                            onClick={handleEditDomain}
                        >
                            Edit Domain
                        </Button>
                    </Box>
                </Box>

                {copySuccess && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        Domain copied to clipboard!
                    </Alert>
                )}

                {/* Domain Overview */}
                <Grid container spacing={3}>
                    {/* Basic Information */}
                    <Grid item xs={12} md={6}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <LanguageIcon sx={{ mr: 1, color: 'primary.main' }} />
                                    <Typography variant="h6">
                                        Basic Information
                                    </Typography>
                                </Box>
                                <TableContainer>
                                    <Table size="small">
                                        <TableBody>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', width: '40%' }}>
                                                    Domain Name
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {domainData.domain}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Target
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {domainData.target || '-'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Type
                                                </TableCell>
                                                <TableCell>
                                                    <Chip 
                                                        label={domainData.type || 'Unknown'} 
                                                        color={getTypeColor(domainData.type)}
                                                        size="small"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Email
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {domainData.email || '-'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Security & SSL */}
                    <Grid item xs={12} md={6}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <SecurityIcon sx={{ mr: 1, color: 'success.main' }} />
                                    <Typography variant="h6">
                                        Security & SSL
                                    </Typography>
                                </Box>
                                <TableContainer>
                                    <Table size="small">
                                        <TableBody>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', width: '40%' }}>
                                                    SSL Mode
                                                </TableCell>
                                                <TableCell>
                                                    <Chip 
                                                        label={domainData.sslMode || 'Not configured'} 
                                                        color={getSSLModeColor(domainData.sslMode)}
                                                        size="small"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    HTTPS Status
                                                </TableCell>
                                                <TableCell>
                                                    <Chip 
                                                        label={domainData.sslMode && domainData.sslMode !== 'disabled' ? 'Enabled' : 'Disabled'}
                                                        color={domainData.sslMode && domainData.sslMode !== 'disabled' ? 'success' : 'error'}
                                                        size="small"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Certificate Type
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {domainData.sslMode === 'letsencrypt' ? 'Let\'s Encrypt (Automatic)' :
                                                         domainData.sslMode === 'manual' ? 'Manual Certificate' :
                                                         'No Certificate'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Security Score
                                                </TableCell>
                                                <TableCell>
                                                    <Chip 
                                                        label={domainData.sslMode === 'letsencrypt' ? 'A+' :
                                                               domainData.sslMode === 'manual' ? 'A' : 'F'}
                                                        color={domainData.sslMode === 'letsencrypt' ? 'success' :
                                                               domainData.sslMode === 'manual' ? 'warning' : 'error'}
                                                        size="small"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Project Configuration */}
                    <Grid item xs={12} md={6}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <StorageIcon sx={{ mr: 1, color: 'info.main' }} />
                                    <Typography variant="h6">
                                        Project Configuration
                                    </Typography>
                                </Box>
                                <TableContainer>
                                    <Table size="small">
                                        <TableBody>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', width: '40%' }}>
                                                    Project Path
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                                        {domainData.projectPath || 'Not configured'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Configuration Status
                                                </TableCell>
                                                <TableCell>
                                                    <Chip 
                                                        label={domainData.projectPath ? 'Configured' : 'Not configured'}
                                                        color={domainData.projectPath ? 'success' : 'warning'}
                                                        size="small"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Deployment Type
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {domainData.type === 'static' ? 'Static Files' :
                                                         domainData.type === 'server' ? 'Dynamic Server' :
                                                         domainData.type === 'redirect' ? 'URL Redirect' :
                                                         'Unknown'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </CardContent>
                        </Card>
                    </Grid>

                    {/* Owner & Management */}
                    <Grid item xs={12} md={6}>
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <PersonIcon sx={{ mr: 1, color: 'warning.main' }} />
                                    <Typography variant="h6">
                                        Owner & Management
                                    </Typography>
                                </Box>
                                <TableContainer>
                                    <Table size="small">
                                        <TableBody>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', width: '40%' }}>
                                                    Owner
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {domainData.owner || 'Not specified'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Contact Email
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">
                                                        {domainData.email || 'Not specified'}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                    Management Status
                                                </TableCell>
                                                <TableCell>
                                                    <Chip 
                                                        label={domainData.owner && domainData.email ? 'Fully Configured' : 'Partially Configured'}
                                                        color={domainData.owner && domainData.email ? 'success' : 'warning'}
                                                        size="small"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>

                {/* Subdomains Section */}
                <Card sx={{ mt: 3 }}>
                    <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6" gutterBottom>
                                Subdomains ({subdomains.length})
                            </Typography>
                            {subdomainsLoading && <CircularProgress size={20} />}
                        </Box>
                        
                        {subdomains.length > 0 ? (
                            <DataGrid
                                rows={subdomains.map((row) => ({ id: row.domain, ...row }))}
                                columns={[
                                    { field: "domain", headerName: "Subdomain", width: 250, editable: false },
                                    { field: "target", headerName: "Target", width: 200, editable: false },
                                    { field: "type", headerName: "Type", width: 100, editable: false },
                                    { field: "sslMode", headerName: "SSL Mode", width: 120, editable: false },
                                    { field: "owner", headerName: "Owner", width: 150, editable: false }
                                ]}
                                pageSize={5}
                                autoHeight
                                sx={{
                                    '& .MuiDataGrid-row': {
                                        cursor: 'pointer',
                                        '&:hover': {
                                            backgroundColor: 'action.hover',
                                        }
                                    }
                                }}
                                onRowClick={(params) => {
                                    // Navigate to subdomain detail
                                    const { id, ...subdomainData } = params.row;
                                    navigate(`/domain/${params.row.domain}`, {
                                        state: { domainData: subdomainData }
                                    });
                                }}
                            />
                        ) : (
                            <Box sx={{ textAlign: 'center', py: 4 }}>
                                <Typography variant="body1" color="text.secondary" gutterBottom>
                                    No subdomains found
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    This domain has no associated subdomains.
                                </Typography>
                            </Box>
                        )}
                    </CardContent>
                </Card>

                {/* Raw Configuration */}
                <Card sx={{ mt: 3 }}>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>
                            Raw Configuration Data
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'grey.2' }}>
                            <Typography 
                                variant="body2" 
                                sx={{ 
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                }}
                            >
                                {JSON.stringify(domainData, null, 2)}
                            </Typography>
                        </Paper>
                    </CardContent>
                </Card>
            </Box>

            {/* Edit Domain Modal */}
            <Modal
                open={editModalOpen}
                onClose={handleCloseEditModal}
                aria-labelledby="edit-domain-modal"
                aria-describedby="edit-domain-form"
            >
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: { xs: '90%', sm: '80%', md: '60%', lg: '50%' },
                        maxWidth: '600px',
                        maxHeight: '90vh',
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                        boxShadow: 24,
                        p: 4,
                        overflow: 'auto'
                    }}
                >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                        <Typography variant="h5" component="h2">
                            Edit Domain: {domainData?.domain}
                        </Typography>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<CloseIcon />}
                            onClick={handleCloseEditModal}
                        >
                            Close
                        </Button>
                    </Box>

                    <Grid container spacing={3}>
                        {/* Basic Information */}
                        <Grid item xs={12}>
                            <Typography variant="h6" gutterBottom color="primary">
                                Basic Information
                            </Typography>
                        </Grid>
                        
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Domain Name"
                                value={editFormData.domain || ''}
                                disabled
                                variant="outlined"
                                helperText="Domain name cannot be changed"
                            />
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Target"
                                value={editFormData.target || ''}
                                onChange={(e) => handleEditFormChange('target', e.target.value)}
                                variant="outlined"
                                placeholder="e.g., localhost:3000"
                            />
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth>
                                <InputLabel>Type</InputLabel>
                                <Select
                                    value={editFormData.type || ''}
                                    label="Type"
                                    onChange={(e) => handleEditFormChange('type', e.target.value)}
                                >
                                    <MenuItem value="server">Server</MenuItem>
                                    <MenuItem value="static">Static</MenuItem>
                                    <MenuItem value="redirect">Redirect</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Email"
                                value={editFormData.email || ''}
                                onChange={(e) => handleEditFormChange('email', e.target.value)}
                                variant="outlined"
                                type="email"
                                placeholder="admin@example.com"
                            />
                        </Grid>

                        {/* SSL Configuration */}
                        <Grid item xs={12}>
                            <Typography variant="h6" gutterBottom color="primary" sx={{ mt: 2 }}>
                                SSL Configuration
                            </Typography>
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth>
                                <InputLabel>SSL Mode</InputLabel>
                                <Select
                                    value={editFormData.sslMode || ''}
                                    label="SSL Mode"
                                    onChange={(e) => handleEditFormChange('sslMode', e.target.value)}
                                >
                                    <MenuItem value="disabled">Disabled</MenuItem>
                                    <MenuItem value="letsencrypt">Let's Encrypt</MenuItem>
                                    <MenuItem value="manual">Manual</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>

                        {/* Project Configuration */}
                        <Grid item xs={12}>
                            <Typography variant="h6" gutterBottom color="primary" sx={{ mt: 2 }}>
                                Project Configuration
                            </Typography>
                        </Grid>

                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                label="Project Path"
                                value={editFormData.projectPath || ''}
                                onChange={(e) => handleEditFormChange('projectPath', e.target.value)}
                                variant="outlined"
                                placeholder="/path/to/project"
                                helperText="Absolute path to the project directory"
                            />
                        </Grid>

                        {/* Owner Information */}
                        <Grid item xs={12}>
                            <Typography variant="h6" gutterBottom color="primary" sx={{ mt: 2 }}>
                                Owner Information
                            </Typography>
                        </Grid>

                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Owner"
                                value={editFormData.owner || ''}
                                onChange={(e) => handleEditFormChange('owner', e.target.value)}
                                variant="outlined"
                                placeholder="Owner name"
                            />
                        </Grid>

                        {/* Action Buttons */}
                        <Grid item xs={12}>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
                                <Button
                                    variant="outlined"
                                    onClick={handleCloseEditModal}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="contained"
                                    startIcon={<SaveIcon />}
                                    onClick={handleSaveDomain}
                                >
                                    Save Changes
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </Box>
            </Modal>

            {/* Snackbar for notifications */}
            <Snackbar
                open={snackbarOpen}
                autoHideDuration={4000}
                onClose={() => setSnackbarOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert 
                    onClose={() => setSnackbarOpen(false)} 
                    severity={snackbarSeverity}
                    sx={{ width: '100%' }}
                >
                    {snackbarMessage}
                </Alert>
            </Snackbar>

            <Footer />
        </>
    );
};

export default DomainDetail;
