import { useEffect, useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Paper,
    Chip,
    Button,
    Grid,
    Alert,
    CircularProgress
} from '@mui/material';
import {
    ArrowBack as ArrowBackIcon,
    ContentCopy as ContentCopyIcon,
    Download as DownloadIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import NetGetAppBar from '../components/AppBar/NetGetAppBar.jsx';
import Footer from '../components/Footer/Footer.jsx';

const LogDetail = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [logData, setLogData] = useState(null);
    const [copySuccess, setCopySuccess] = useState(false);

    useEffect(() => {
        // Get log data from navigation state
        if (location.state && location.state.logData) {
            setLogData(location.state.logData);
        } else {
            // If no data in state, redirect back to logs
            navigate('/logs');
        }
    }, [location, navigate]);

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    const downloadLog = () => {
        if (!logData) return;
        
        const logText = logData.fullLine || logData.message;
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `log-${logData.id}-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const getMethodColor = (method) => {
        switch (method) {
            case 'GET': return 'primary';
            case 'POST': return 'success';
            case 'PUT': return 'warning';
            case 'DELETE': return 'error';
            case 'OPTIONS': return 'default';
            default: return 'default';
        }
    };

    const getLevelColor = (level) => {
        switch (level) {
            case 'INFO': return 'info';
            case 'WARN': return 'warning';
            case 'ERROR': return 'error';
            case 'DEBUG': return 'default';
            default: return 'default';
        }
    };

    const getStatusColor = (status) => {
        if (status >= 500) return 'error';
        if (status >= 400) return 'warning';
        if (status >= 300) return 'info';
        if (status >= 200) return 'success';
        return 'default';
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    if (!logData) {
        return (
            <>
                <NetGetAppBar />
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
                    <CircularProgress />
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
                            onClick={() => navigate('/logs')}
                        >
                            Back to Logs
                        </Button>
                        <Typography variant="h4" component="h1">
                            Log Details
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="outlined"
                            startIcon={<ContentCopyIcon />}
                            onClick={() => copyToClipboard(logData.fullLine || logData.message)}
                        >
                            Copy
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<DownloadIcon />}
                            onClick={downloadLog}
                        >
                            Download
                        </Button>
                    </Box>
                </Box>

                {copySuccess && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        Log copied to clipboard!
                    </Alert>
                )}

                {/* Log Overview */}
                <Card sx={{ mb: 3 }}>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>
                            Log Overview
                        </Typography>
                        <Grid container spacing={2}>
                            <Grid item xs={12} md={6}>
                                <Typography variant="subtitle2" color="text.secondary">
                                    Timestamp
                                </Typography>
                                <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                                    {formatTimestamp(logData.timestamp)}
                                </Typography>
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Typography variant="subtitle2" color="text.secondary">
                                    Level
                                </Typography>
                                <Chip 
                                    label={logData.level} 
                                    color={getLevelColor(logData.level)}
                                    sx={{ mt: 0.5 }}
                                />
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Typography variant="subtitle2" color="text.secondary">
                                    Log Type
                                </Typography>
                                <Chip 
                                    label={logData.logType || 'Unknown'} 
                                    variant="outlined"
                                    sx={{ mt: 0.5 }}
                                />
                            </Grid>

                            {/* Access Log Specific Fields */}
                            {logData.logType === 'access' && (
                                <>
                                    <Grid item xs={12} md={3}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Method
                                        </Typography>
                                        {logData.method && (
                                            <Chip 
                                                label={logData.method} 
                                                color={getMethodColor(logData.method)}
                                                sx={{ mt: 0.5 }}
                                            />
                                        )}
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Status Code
                                        </Typography>
                                        {logData.status && (
                                            <Chip 
                                                label={logData.status} 
                                                color={getStatusColor(logData.status)}
                                                sx={{ mt: 0.5 }}
                                            />
                                        )}
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Response Size
                                        </Typography>
                                        <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                                            {logData.size ? `${(logData.size / 1024).toFixed(1)} KB` : '-'}
                                        </Typography>
                                    </Grid>
                                    <Grid item xs={12} md={3}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Client IP
                                        </Typography>
                                        <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                                            {logData.ip || '-'}
                                        </Typography>
                                    </Grid>
                                    <Grid item xs={12}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Request Path
                                        </Typography>
                                        <Typography variant="body1" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                            {logData.path || '-'}
                                        </Typography>
                                    </Grid>
                                    {logData.userAgent && (
                                        <Grid item xs={12}>
                                            <Typography variant="subtitle2" color="text.secondary">
                                                User Agent
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                                {logData.userAgent}
                                            </Typography>
                                        </Grid>
                                    )}
                                </>
                            )}

                            {/* Error Log Specific Fields */}
                            {logData.logType === 'error' && (
                                <>
                                    {logData.pid && (
                                        <Grid item xs={12} md={3}>
                                            <Typography variant="subtitle2" color="text.secondary">
                                                Process ID
                                            </Typography>
                                            <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                                                {logData.pid}
                                            </Typography>
                                        </Grid>
                                    )}
                                    {logData.tid && (
                                        <Grid item xs={12} md={3}>
                                            <Typography variant="subtitle2" color="text.secondary">
                                                Thread ID
                                            </Typography>
                                            <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                                                {logData.tid}
                                            </Typography>
                                        </Grid>
                                    )}
                                </>
                            )}

                            {/* Server Log Specific Fields */}
                            {logData.logType === 'server' && logData.method && (
                                <>
                                    <Grid item xs={12} md={3}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Method
                                        </Typography>
                                        <Chip 
                                            label={logData.method} 
                                            color={getMethodColor(logData.method)}
                                            sx={{ mt: 0.5 }}
                                        />
                                    </Grid>
                                    <Grid item xs={12} md={9}>
                                        <Typography variant="subtitle2" color="text.secondary">
                                            Path
                                        </Typography>
                                        <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                                            {logData.path || '-'}
                                        </Typography>
                                    </Grid>
                                </>
                            )}
                        </Grid>
                    </CardContent>
                </Card>

                {/* Log Message */}
                <Card sx={{ mb: 3 }}>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>
                            Log Message
                        </Typography>
                        <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'grey.900' }}>
                            <Typography 
                                variant="body2" 
                                sx={{ 
                                    fontFamily: 'monospace',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                }}
                            >
                                {logData.message}
                            </Typography>
                        </Paper>
                    </CardContent>
                </Card>

                {/* Raw Log Line */}
                {logData.fullLine && logData.fullLine !== logData.message && (
                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                Raw Log Line
                            </Typography>
                            <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'grey.900' }}>
                                <Typography 
                                    variant="body2" 
                                    sx={{ 
                                        fontFamily: 'monospace',
                                        color: 'white',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all'
                                    }}
                                >
                                    {logData.fullLine}
                                </Typography>
                            </Paper>
                        </CardContent>
                    </Card>
                )}
            </Box>
            <Footer />
        </>
    );
};

export default LogDetail;
