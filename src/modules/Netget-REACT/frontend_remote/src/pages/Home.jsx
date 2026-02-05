import React, { useEffect, useState } from "react";
import { Box, Card, CardContent, Typography, Snackbar, IconButton } from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import EditIcon from "@mui/icons-material/Edit";
import NetGetAppBar from "../components/AppBar/NetGetAppBar.jsx";
import Footer from "../components/Footer/Footer.jsx";

let domains_route = "https://api.netget.site";

const Home = () => {
  const [domains, setDomains] = useState([]);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [editableDomain, setEditableDomain] = useState(null);

  useEffect(() => {
    fetchDomains();
  }, []);

  // Función para obtener los dominios desde la base de datos
  const fetchDomains = async () => {
    try {
      const response = await fetch(`${domains_route}/domains`, { 
        method: "GET",
        credentials: "include" 
      })
      .then(response => {
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            window.location.href = "/login"; // Redirige si no está autenticado
          }
          throw new Error("Error en la solicitud");
        }
        return response.json();
      })
      .then(data => {
        setDomains(data);
      })
      .catch(error => console.error("Error:", error));
    } catch (error) {
      console.error("Error loading domains:", error);
    }
  };

  // Función para actualizar un dominio en la base de datos y en la UI
  const handleEditCell = async (newRow, oldRow) => {
    if (newRow.id !== editableDomain) return oldRow; // Prevent updates if not in edit mode
    
    const { id, ...updatedFields } = newRow;
    try {
      const response = await fetch(`${domains_route}/update-domain`, {
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
      return oldRow; // Revert changes in case of error
    }
  };

  const columns = [
    { field: "domain", headerName: "Domain", width: 200, editable: false },
    { field: "email", headerName: "Email", width: 180, editable: (params) => params.row.id === editableDomain },
    { field: "sslMode", headerName: "SSL Mode", width: 120, editable: (params) => params.row.id === editableDomain },
    { field: "target", headerName: "Target", width: 180, editable: (params) => params.row.id === editableDomain },
    { field: "type", headerName: "Type", width: 60, editable: (params) => params.row.id === editableDomain },
    { field: "projectPath", headerName: "Project Path", width: 200, editable: (params) => params.row.id === editableDomain },
    { field: "owner", headerName: "Owner", width: 100, editable: (params) => params.row.id === editableDomain },
    {
      field: "actions",
      headerName: "Actions",
      width: 100,
      renderCell: (params) => (
        <IconButton onClick={() => setEditableDomain(params.row.id)}>
          <EditIcon color={editableDomain === params.row.id ? "secondary" : "primary"} />
        </IconButton>
      ),
    },
  ];

  return (
    <>
      <NetGetAppBar />
      <Box sx={{ px: 2, py: 2, mt: 8, display: "flex", justifyContent: "center" }}>
        <Card sx={{ width: "90%", p: 3, boxShadow: 2, borderRadius: 2 }}>
          <Typography variant="h5" sx={{ textAlign: "center", fontWeight: "bold", mb: 3 }}>
            My Domains
          </Typography>
          <CardContent>
            <DataGrid
              rows={domains.map((row) => ({ id: row.domain, ...row }))}
              columns={columns}
              pageSize={5}
              autoHeight
              processRowUpdate={handleEditCell} // Maneja las ediciones y actualiza en tiempo real
            />
          </CardContent>
        </Card>
      </Box>
      <Footer />
      {/* Snackbar para mostrar mensajes de éxito o error */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
      />
    </>
  );
};

export default Home;
