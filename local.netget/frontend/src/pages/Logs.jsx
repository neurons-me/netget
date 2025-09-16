import React, { useEffect, useState } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    Button,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Pagination,
    CircularProgress,
    Alert,
    IconButton,
    Tooltip
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Download as DownloadIcon,
    FilterList as FilterIcon,
    Clear as ClearIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import NetGetAppBar from '../components/AppBar/NetGetAppBar';
import Footer from '../components/Footer/Footer';

const domains_route = import.meta.env.VITE_API_URL || "http://localhost:3000";

const Logs = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [totalLogs, setTotalLogs] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);
    const [filterLevel, setFilterLevel] = useState('');
    const [filterMethod, setFilterMethod] = useState('');
    const [searchPath, setSearchPath] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [logType, setLogType] = useState('access'); // 'access', 'error', 'server'
    const [fileInfo, setFileInfo] = useState(null);
    const [domainFilter, setDomainFilter] = useState('');

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const offset = (page - 1) * limit;
            const params = new URLSearchParams({
                type: logType,
                limit: limit.toString(),
                offset: offset.toString()
            });

            const response = await fetch(`${domains_route}/logs?${params}`, {
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    window.location.href = '/login';
                    return;
                }
                throw new Error('Failed to fetch logs');
            }

            const data = await response.json();
            let filteredLogs = data.logs;

            // Apply client-side filters
            if (filterLevel) {
                filteredLogs = filteredLogs.filter(log => log.level === filterLevel);
            }
            if (filterMethod && logType !== 'error') {
                filteredLogs = filteredLogs.filter(log => log.method === filterMethod);
            }
            if (searchPath) {
                filteredLogs = filteredLogs.filter(log => 
                    (log.path && log.path.toLowerCase().includes(searchPath.toLowerCase())) ||
                    log.message.toLowerCase().includes(searchPath.toLowerCase()) ||
                    (log.ip && log.ip.includes(searchPath))
                );
            }

            setLogs(filteredLogs);
            setTotalLogs(data.total);
            setFileInfo({
                fileSize: data.fileSize,
                truncated: data.truncated,
                logType: data.logType
            });
            setError(null);
        } catch (err) {
            console.error('Error fetching logs:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [page, limit, logType]);

    useEffect(() => {
        if (autoRefresh) {
            const interval = setInterval(fetchLogs, 5000); // Refresh every 5 seconds
            return () => clearInterval(interval);
        }
    }, [autoRefresh, page, limit, logType]);

    // Handle domain filter from navigation state
    useEffect(() => {
        if (location.state && location.state.domainFilter) {
            setDomainFilter(location.state.domainFilter);
            setSearchPath(location.state.domainFilter); // Use searchPath to filter by domain
            // Clear the navigation state to prevent sticky filter
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);

    const handlePageChange = (event, newPage) => {
        setPage(newPage);
    };

    const handleLimitChange = (event) => {
        setLimit(event.target.value);
        setPage(1); // Reset to first page
    };

    const clearFilters = () => {
        setFilterLevel('');
        setFilterMethod('');
        setSearchPath('');
        setDomainFilter('');
        setPage(1);
    };

    const handleLogTypeChange = (event) => {
        setLogType(event.target.value);
        setPage(1);
        clearFilters();
    };

    const downloadLogs = () => {
        const logText = logs.map(log => log.fullLine).join('\n');
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `netget-logs-${new Date().toISOString().split('T')[0]}.txt`;
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

    const truncateText = (text, maxLength = 50) => {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    };

    const handleRowClick = (log) => {
        // Navigate to log detail page with log data
        navigate(`/logs/${log.domain}`, { 
            state: { 
                logData: log,
                returnPath: '/logs'
            } 
        });
    };

    return (
        <>
            <NetGetAppBar />
            <Box sx={{ px: 2, py: 2, mt: 8 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Box>
                        <Typography variant="h4" component="h1" gutterBottom>
                            Server Logs
                        </Typography>
                        <Typography variant="subtitle1" color="text.secondary">
                            Main NetGet Instance Activity
                            {fileInfo && (
                                <span> - {fileInfo.fileSize} {fileInfo.truncated && '(truncated)'}</span>
                            )}
                        </Typography>
                        {domainFilter && (
                            <Box sx={{ mt: 1 }}>
                                <Chip 
                                    label={`Filtered by domain: ${domainFilter}`}
                                    color="primary"
                                    variant="outlined"
                                    onDelete={() => {
                                        setDomainFilter('');
                                        setSearchPath('');
                                    }}
                                    size="small"
                                />
                            </Box>
                        )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="outlined"
                            onClick={() => navigate('/home')}
                        >
                            Back to Home
                        </Button>
                    </Box>
                </Box>

                {/* Controls */}
                <Card sx={{ mb: 3 }}>
                    <CardContent>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                            <FormControl size="small" sx={{ minWidth: 140 }}>
                                <InputLabel>Log Type</InputLabel>
                                <Select
                                    value={logType}
                                    label="Log Type"
                                    onChange={handleLogTypeChange}
                                >
                                    <MenuItem value="access">Nginx Access</MenuItem>
                                    <MenuItem value="error">Nginx Error</MenuItem>
                                    <MenuItem value="server">Server Log</MenuItem>
                                </Select>
                            </FormControl>

                            <TextField
                                label={logType === 'error' ? "Search Message/PID" : "Search Path/Message/IP"}
                                variant="outlined"
                                size="small"
                                value={searchPath}
                                onChange={(e) => setSearchPath(e.target.value)}
                                sx={{ minWidth: 200 }}
                            />
                            
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <InputLabel>Level</InputLabel>
                                <Select
                                    value={filterLevel}
                                    label="Level"
                                    onChange={(e) => setFilterLevel(e.target.value)}
                                >
                                    <MenuItem value="">All</MenuItem>
                                    <MenuItem value="INFO">INFO</MenuItem>
                                    <MenuItem value="WARN">WARN</MenuItem>
                                    <MenuItem value="ERROR">ERROR</MenuItem>
                                    <MenuItem value="DEBUG">DEBUG</MenuItem>
                                </Select>
                            </FormControl>

                            {logType !== 'error' && (
                                <FormControl size="small" sx={{ minWidth: 120 }}>
                                    <InputLabel>Method</InputLabel>
                                    <Select
                                        value={filterMethod}
                                        label="Method"
                                        onChange={(e) => setFilterMethod(e.target.value)}
                                    >
                                        <MenuItem value="">All</MenuItem>
                                        <MenuItem value="GET">GET</MenuItem>
                                        <MenuItem value="POST">POST</MenuItem>
                                        <MenuItem value="PUT">PUT</MenuItem>
                                        <MenuItem value="DELETE">DELETE</MenuItem>
                                        <MenuItem value="OPTIONS">OPTIONS</MenuItem>
                                    </Select>
                                </FormControl>
                            )}

                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <InputLabel>Per Page</InputLabel>
                                <Select
                                    value={limit}
                                    label="Per Page"
                                    onChange={handleLimitChange}
                                >
                                    <MenuItem value={25}>25</MenuItem>
                                    <MenuItem value={50}>50</MenuItem>
                                    <MenuItem value={100}>100</MenuItem>
                                    <MenuItem value={200}>200</MenuItem>
                                </Select>
                            </FormControl>

                            <Tooltip title="Apply Filters">
                                <IconButton onClick={fetchLogs} color="primary">
                                    <FilterIcon />
                                </IconButton>
                            </Tooltip>

                            <Tooltip title="Clear Filters">
                                <IconButton onClick={clearFilters}>
                                    <ClearIcon />
                                </IconButton>
                            </Tooltip>

                            <Tooltip title="Refresh">
                                <IconButton onClick={fetchLogs} disabled={loading}>
                                    <RefreshIcon />
                                </IconButton>
                            </Tooltip>

                            <Tooltip title="Download Logs">
                                <IconButton onClick={downloadLogs} disabled={logs.length === 0}>
                                    <DownloadIcon />
                                </IconButton>
                            </Tooltip>

                            <Button
                                variant={autoRefresh ? "contained" : "outlined"}
                                size="small"
                                onClick={() => setAutoRefresh(!autoRefresh)}
                            >
                                Auto Refresh {autoRefresh ? 'ON' : 'OFF'}
                            </Button>
                        </Box>
                    </CardContent>
                </Card>

                {/* Error Display */}
                {error && (
                    <Alert severity="error" sx={{ mb: 3 }}>
                        {error}
                    </Alert>
                )}

                {/* Logs Table */}
                <Card>
                    <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6">
                                Logs ({logs.length} of {totalLogs})
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {loading && <CircularProgress size={20} />}
                                <Typography variant="caption" color="text.secondary">
                                    💡 Hover for preview • Click for details
                                </Typography>
                            </Box>
                        </Box>

                        {loading && logs.length === 0 ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress />
                            </Box>
                        ) : logs.length === 0 ? (
                            <Box sx={{ textAlign: 'center', py: 6 }}>
                                <Typography variant="h6" color="text.secondary" gutterBottom>
                                    No logs found
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {logType === 'access' && 'No access logs available for the selected criteria.'}
                                    {logType === 'error' && 'No error logs available for the selected criteria.'}
                                    {logType === 'server' && 'No server logs available for the selected criteria.'}
                                </Typography>
                                <Button 
                                    variant="outlined" 
                                    onClick={fetchLogs} 
                                    sx={{ mt: 2 }}
                                    disabled={loading}
                                >
                                    Refresh
                                </Button>
                            </Box>
                        ) : (
                            <>
                                <TableContainer component={Paper} variant="outlined">
                                    <Table size="small" sx={{ cursor: 'pointer' }}>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Timestamp</TableCell>
                                                <TableCell>Level</TableCell>
                                                {logType === 'access' && (
                                                    <>
                                                        <TableCell>Method</TableCell>
                                                        <TableCell>Path</TableCell>
                                                        <TableCell>Status</TableCell>
                                                        <TableCell>IP</TableCell>
                                                    </>
                                                )}
                                                {logType === 'error' && (
                                                    <>
                                                        <TableCell>PID</TableCell>
                                                        <TableCell>Error Message</TableCell>
                                                    </>
                                                )}
                                                {logType === 'server' && (
                                                    <>
                                                        <TableCell>Method</TableCell>
                                                        <TableCell>Path</TableCell>
                                                    </>
                                                )}
                                                <TableCell>Quick Preview</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {logs.map((log) => (
                                                <Tooltip 
                                                    key={log.id}
                                                    title={
                                                        <Box sx={{ maxWidth: 600 }}>
                                                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                                                Full Log Entry
                                                            </Typography>
                                                            <Typography 
                                                                variant="body2" 
                                                                sx={{ 
                                                                    fontFamily: 'monospace',
                                                                    whiteSpace: 'pre-wrap',
                                                                    wordBreak: 'break-all'
                                                                }}
                                                            >
                                                                {log.fullLine || log.message}
                                                            </Typography>
                                                            <Typography 
                                                                variant="caption" 
                                                                sx={{ 
                                                                    display: 'block',
                                                                    mt: 1,
                                                                    fontStyle: 'italic',
                                                                    color: 'primary.main'
                                                                }}
                                                            >
                                                                💡 Click row for detailed view
                                                            </Typography>
                                                        </Box>
                                                    }
                                                    placement="top-start"
                                                    arrow
                                                >
                                                    <TableRow 
                                                        onClick={() => handleRowClick(log)}
                                                        sx={{ 
                                                            '&:hover': { 
                                                                backgroundColor: 'action.hover',
                                                                boxShadow: 1
                                                            },
                                                            cursor: 'pointer',
                                                            transition: 'all 0.2s ease-in-out'
                                                        }}
                                                    >
                                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                                            {new Date(log.timestamp).toLocaleTimeString()}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip 
                                                                label={log.level} 
                                                                size="small" 
                                                                color={getLevelColor(log.level)}
                                                            />
                                                        </TableCell>
                                                        
                                                        {logType === 'access' && (
                                                            <>
                                                                <TableCell>
                                                                    {log.method && (
                                                                        <Chip 
                                                                            label={log.method} 
                                                                            size="small" 
                                                                            color={getMethodColor(log.method)}
                                                                        />
                                                                    )}
                                                                </TableCell>
                                                                <TableCell 
                                                                    sx={{ 
                                                                        fontFamily: 'monospace', 
                                                                        fontSize: '0.75rem',
                                                                        maxWidth: '200px'
                                                                    }}
                                                                >
                                                                    {truncateText(log.path, 30)}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {log.status && (
                                                                        <Chip 
                                                                            label={log.status} 
                                                                            size="small" 
                                                                            color={getStatusColor(log.status)}
                                                                        />
                                                                    )}
                                                                </TableCell>
                                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                                                    {truncateText(log.ip, 15) || '-'}
                                                                </TableCell>
                                                            </>
                                                        )}
                                                        
                                                        {logType === 'error' && (
                                                            <>
                                                                <TableCell sx={{ fontSize: '0.75rem' }}>
                                                                    {log.pid || '-'}
                                                                </TableCell>
                                                                <TableCell 
                                                                    sx={{ 
                                                                        fontFamily: 'monospace', 
                                                                        fontSize: '0.75rem',
                                                                        maxWidth: '300px'
                                                                    }}
                                                                >
                                                                    {truncateText(log.message, 40)}
                                                                </TableCell>
                                                            </>
                                                        )}
                                                        
                                                        {logType === 'server' && (
                                                            <>
                                                                <TableCell>
                                                                    {log.method && (
                                                                        <Chip 
                                                                            label={log.method} 
                                                                            size="small" 
                                                                            color={getMethodColor(log.method)}
                                                                        />
                                                                    )}
                                                                </TableCell>
                                                                <TableCell 
                                                                    sx={{ 
                                                                        fontFamily: 'monospace', 
                                                                        fontSize: '0.75rem',
                                                                        maxWidth: '200px'
                                                                    }}
                                                                >
                                                                    {truncateText(log.path, 30)}
                                                                </TableCell>
                                                            </>
                                                        )}
                                                        
                                                        <TableCell sx={{ 
                                                            fontFamily: 'monospace', 
                                                            fontSize: '0.75rem',
                                                            maxWidth: '250px',
                                                            color: 'text.secondary'
                                                        }}>
                                                            {truncateText(log.message, 35)}
                                                        </TableCell>
                                                    </TableRow>
                                                </Tooltip>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>

                                {/* Pagination */}
                                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                                    <Pagination
                                        count={Math.ceil(totalLogs / limit)}
                                        page={page}
                                        onChange={handlePageChange}
                                        color="primary"
                                        showFirstButton
                                        showLastButton
                                    />
                                </Box>
                            </>
                        )}
                    </CardContent>
                </Card>
            </Box>
            <Footer />
        </>
    );
};

export default Logs;