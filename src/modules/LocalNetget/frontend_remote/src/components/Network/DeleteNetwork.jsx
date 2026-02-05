import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

const DeleteNetwork = () => {
  const navigate = useNavigate();
  const [networks, setNetworks] = useState({});
  const [open, setOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);

  useEffect(() => {
    const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
    setNetworks(storedNetworks.networks);
  }, []);

  // Open delete confirmation modal
  const handleOpen = (networkName) => {
    setSelectedNetwork(networkName);
    setOpen(true);
  };

  // Close modal
  const handleClose = () => {
    setOpen(false);
    setSelectedNetwork(null);
  };

  // Delete the selected network
  const handleDelete = () => {
    if (!selectedNetwork) return;

    const updatedNetworks = { ...networks };
    delete updatedNetworks[selectedNetwork];

    localStorage.setItem("networks", JSON.stringify({ networks: updatedNetworks }));
    setNetworks(updatedNetworks);
    handleClose();

    // Navigate back to network grid after deletion
    navigate("/networks");
  };

  return (
    <Box sx={{ px: 2, py: 2 }}>
      <Typography variant="h4" sx={{ textAlign: "center", fontWeight: "bold", mb: 3 }}>
        Delete a Network
      </Typography>

      <Grid container spacing={2} justifyContent="center">
        {Object.entries(networks).map(([key, value]) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={key}>
            <Card
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                p: 2,
                textAlign: "center",
                boxShadow: 2,
                borderRadius: 2,
                transition: "transform 0.3s ease, box-shadow 0.3s ease",
                "&:hover": {
                  transform: "scale(1.05)",
                  boxShadow: 6,
                },
              }}
            >
              <CardContent>
                <Typography variant="h6">{key}</Typography>
                <Typography variant="body2" sx={{ color: "gray" }}>
                  IP: {value.ip}
                </Typography>
                <Typography variant="body2" sx={{ color: "gray" }}>
                  Owner: {value.owner}
                </Typography>
              </CardContent>
              <Button variant="contained" color="error" onClick={() => handleOpen(key)}>
                Delete
              </Button>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Confirmation Modal */}
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Delete Network</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{selectedNetwork}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDelete} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DeleteNetwork;
