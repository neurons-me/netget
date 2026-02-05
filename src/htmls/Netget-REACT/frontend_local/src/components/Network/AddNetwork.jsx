import { useState } from "react";
import {
  TextField,
  Button,
  Card,
  CardContent,
  Typography,
  Box,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

const AddNetwork = () => {
  const navigate = useNavigate();
  const [networkData, setNetworkData] = useState({
    name: "",
    ip: "",
    owner: "",
  });

  const handleChange = (e) => {
    setNetworkData({ ...networkData, [e.target.name]: e.target.value });
  };

  const handleSubmit = () => {
    if (!networkData.name || !networkData.ip || !networkData.owner) {
      alert("Todos los campos son obligatorios.");
      return;
    }

    // Obtener redes guardadas (puede venir de localStorage o de una API)
    const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };

    // Agregar la nueva red
    storedNetworks.networks[networkData.name] = {
      name: networkData.name,
      ip: networkData.ip,
      owner: networkData.owner,
    };

    // Guardar de nuevo en localStorage (temporal, para simular persistencia)
    localStorage.setItem("networks", JSON.stringify(storedNetworks));

    // Redirigir a la lista de redes
    navigate("/networks");
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "center", mt: 5 }}>
      <Card sx={{ width: 400, p: 3, boxShadow: 3, borderRadius: 2 }}>
        <CardContent>
          <Typography variant="h5" sx={{ mb: 2, textAlign: "center" }}>
            Add Network
          </Typography>
          <TextField
            fullWidth
            label="Network Name"
            name="name"
            value={networkData.name}
            onChange={handleChange}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Server IP"
            name="ip"
            value={networkData.ip}
            onChange={handleChange}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Owner"
            name="owner"
            value={networkData.owner}
            onChange={handleChange}
            margin="normal"
          />
          <Button
            fullWidth
            variant="contained"
            color="primary"
            sx={{ mt: 2 }}
            onClick={handleSubmit}
          >
            Add Network
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
};

export default AddNetwork;
