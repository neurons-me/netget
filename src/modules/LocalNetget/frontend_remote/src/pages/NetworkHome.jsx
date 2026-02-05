/**
 * NetworkHome Component
 * 
 * This component represents the domain management interface for a specific NetGet network instance.
 * It allows users to:
 * - View all domains managed by the selected network instance
 * - Edit domain properties in real-time
 * - Add new domains to the network instance
 * - Manage network-specific configurations
 * 
 * The component fetches domain data from the specific network instance's API endpoints,
 * allowing management of multiple NetGet instances from a single interface.
 */

import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Snackbar,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import NetworksIcon from "@mui/icons-material/Hub";
import { useParams, useNavigate } from "react-router-dom";
import NetGetAppBar from "../components/AppBar/NetGetAppBar.jsx";
import Footer from "../components/Footer/Footer.jsx";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const NetworkHome = () => {
  const { networkName } = useParams();
  const navigate = useNavigate();
  const [domains, setDomains] = useState([]);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [editableDomain, setEditableDomain] = useState(null);
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [newDomain, setNewDomain] = useState({
    domain: "",
    email: "",
    target: "",
    type: "server",
    owner: "",
  });
  const [networkInfo, setNetworkInfo] = useState(null);

  useEffect(() => {
    // Get network info from localStorage
    const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
    const currentNetwork = storedNetworks.networks[networkName];
    setNetworkInfo(currentNetwork);

    if (currentNetwork) {
      fetchDomains(currentNetwork.ip);
    }
  }, [networkName]);

  // Function to fetch domains from the specific network instance
  const fetchDomains = async (networkIP) => {
    try {
      const response = await fetch(`${API_BASE_URL}/domains`, { 
        method: "GET",
        credentials: "include" 
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          // If unauthorized, redirect back to network selection
          navigate("/networks");
          return;
        }
        throw new Error("Error fetching domains");
      }

      const data = await response.json();
      setDomains(data.map(domain => ({ ...domain, id: domain.domain })));
    } catch (error) {
      console.error("Error loading domains:", error);
      setSnackbarMessage("Error loading domains from network instance");
      setSnackbarOpen(true);
    }
  };

  // Function to update a domain in the database and UI
  const handleEditCell = async (newRow, oldRow) => {
    if (newRow.id !== editableDomain) return oldRow;
    
    const { id, ...updatedFields } = newRow;
    try {
      const response = await fetch(`${API_BASE_URL}/update-domain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: id, updatedFields }),
      });

      if (response.ok) {
        setSnackbarMessage("Domain updated successfully!");
        setSnackbarOpen(true);
        setEditableDomain(null);
        
        // Update the UI instantly
        setDomains((prevDomains) =>
          prevDomains.map((domain) =>
            domain.domain === id ? { ...domain, ...updatedFields } : domain
          )
        );
        return newRow;
      } else {
        throw new Error("Failed to update domain.");
      }
    } catch (error) {
      console.error("Error updating domain:", error);
      setSnackbarMessage("Error updating domain.");
      setSnackbarOpen(true);
      return oldRow;
    }
  };

  // Function to add a new domain
  const handleAddDomain = async () => {
    if (!newDomain.domain || !newDomain.email || !newDomain.target || !newDomain.owner) {
      setSnackbarMessage("All fields are required");
      setSnackbarOpen(true);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/add-domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newDomain),
      });

      if (response.ok) {
        setSnackbarMessage("Domain added successfully!");
        setSnackbarOpen(true);
        setAddDomainOpen(false);
        setNewDomain({ domain: "", email: "", target: "", type: "server", owner: "" });
        
        // Refresh domains list
        fetchDomains(networkInfo.ip);
      } else {
        throw new Error("Failed to add domain.");
      }
    } catch (error) {
      console.error("Error adding domain:", error);
      setSnackbarMessage("Error adding domain.");
      setSnackbarOpen(true);
    }
  };

  const columns = [
    { field: "domain", headerName: "Domain", width: 200, editable: false },
    { field: "email", headerName: "Email", width: 180, editable: (params) => params.row.id === editableDomain },
    { field: "target", headerName: "Target", width: 150, editable: (params) => params.row.id === editableDomain },
    { field: "type", headerName: "Type", width: 100, editable: (params) => params.row.id === editableDomain },
    { field: "owner", headerName: "Owner", width: 120, editable: (params) => params.row.id === editableDomain },
    {
      field: "sslMode",
      headerName: "SSL Mode",
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value || "None"}
          color={params.value === "letsencrypt" ? "success" : "default"}
          size="small"
        />
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <IconButton
          color="primary"
          onClick={() => {
            setEditableDomain(editableDomain === params.row.id ? null : params.row.id);
          }}
        >
          <EditIcon />
        </IconButton>
      ),
    },
  ];

  if (!networkInfo) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">Network not found</Typography>
        <Button onClick={() => navigate("/networks")}>Back to Networks</Button>
      </Box>
    );
  }

  return (
    <Box>
      <NetGetAppBar />
      {/* Add top margin to separate from AppBar */}
      <Box sx={{ p: 3, mt: { xs: 7, sm: 8 } }}>
        {/* Network Info Header */}
        <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
          <Button
            startIcon={<NetworksIcon />}
            onClick={() => navigate("/networks")}
            sx={{ mr: 2 }}
          >
            Back to Networks
          </Button>
          <Card sx={{ flexGrow: 1, p: 2 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="h5" component="h1" gutterBottom>
                  {networkName} Network Instance
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  IP: {networkInfo.ip} | Owner: {networkInfo.owner}
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setAddDomainOpen(true)}
              >
                Add Domain
              </Button>
            </Box>
          </Card>
        </Box>

        {/* Domains Table */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Domains ({domains.length})
            </Typography>
            <Box sx={{ height: 800, width: "100%" }}>
              <DataGrid
                rows={domains}
                columns={columns}
                pageSize={10}
                rowsPerPageOptions={[10, 25, 50]}
                disableSelectionOnClick
                processRowUpdate={handleEditCell}
                onProcessRowUpdateError={(error) => {
                  console.error("Error processing row update:", error);
                  setSnackbarMessage("Error updating domain");
                  setSnackbarOpen(true);
                }}
                experimentalFeatures={{ newEditingApi: true }}
              />
            </Box>
          </CardContent>
        </Card>

        {/* Add Domain Dialog */}
        <Dialog open={addDomainOpen} onClose={() => setAddDomainOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Add New Domain</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Domain"
              type="text"
              fullWidth
              variant="outlined"
              value={newDomain.domain}
              onChange={(e) => setNewDomain({ ...newDomain, domain: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              margin="dense"
              label="Email"
              type="email"
              fullWidth
              variant="outlined"
              value={newDomain.email}
              onChange={(e) => setNewDomain({ ...newDomain, email: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              margin="dense"
              label="Target"
              type="text"
              fullWidth
              variant="outlined"
              value={newDomain.target}
              onChange={(e) => setNewDomain({ ...newDomain, target: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              margin="dense"
              label="Type"
              type="text"
              fullWidth
              variant="outlined"
              value={newDomain.type}
              onChange={(e) => setNewDomain({ ...newDomain, type: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              margin="dense"
              label="Owner"
              type="text"
              fullWidth
              variant="outlined"
              value={newDomain.owner}
              onChange={(e) => setNewDomain({ ...newDomain, owner: e.target.value })}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddDomainOpen(false)}>Cancel</Button>
            <Button onClick={handleAddDomain} variant="contained">Add Domain</Button>
          </DialogActions>
        </Dialog>

        {/* Snackbar for notifications */}
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={() => setSnackbarOpen(false)}
          message={snackbarMessage}
        />
      </Box>
      <Footer />
    </Box>
  );
};

export default NetworkHome;
