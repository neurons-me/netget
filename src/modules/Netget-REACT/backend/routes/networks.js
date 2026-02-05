import express from 'express';
import {
  addNetwork,
  getAllNetworks,
  getNetworkByName,
  updateNetwork,
  deleteNetwork,
  getNetworksCount,
  migrateNetworksFromLocalStorage
} from '../utils/networks_db.js';

const router = express.Router();

/**
 * GET /networks
 * Retrieve all networks
 */
router.get('/', async (req, res) => {
  try {
    const networks = await getAllNetworks();
    res.json({ success: true, networks });
  } catch (error) {
    console.error("Error getting networks:", error);
    res.status(500).json({ success: false, error: "Failed to retrieve networks" });
  }
});

/**
 * POST /networks
 * Add a new network
 */
router.post('/', async (req, res) => {
  try {
    const { name, ip, owner } = req.body;
    
    if (!name || !ip || !owner) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: name, ip, and owner are required" 
      });
    }
    
    const network = await addNetwork(name, ip, owner);
    res.status(201).json({ success: true, network });
  } catch (error) {
    console.error("Error adding network:", error);
    if (error.message.includes("already exists")) {
      res.status(409).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Failed to add network" });
    }
  }
});

/**
 * GET /networks/:name
 * Get a specific network by name
 */
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const network = await getNetworkByName(decodeURIComponent(name));
    
    if (!network) {
      return res.status(404).json({ success: false, error: "Network not found" });
    }
    
    res.json({ success: true, network });
  } catch (error) {
    console.error("Error getting network:", error);
    res.status(500).json({ success: false, error: "Failed to retrieve network" });
  }
});

/**
 * PUT /networks/:name
 * Update a network
 */
router.put('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const updates = req.body;
    
    const decodedName = decodeURIComponent(name);
    const network = await updateNetwork(decodedName, updates);
    
    if (!network) {
      return res.status(404).json({ success: false, error: "Network not found" });
    }
    
    res.json({ success: true, network });
  } catch (error) {
    console.error("Error updating network:", error);
    res.status(500).json({ success: false, error: "Failed to update network" });
  }
});

/**
 * DELETE /networks/:name
 * Delete a network
 */
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name);
    const deleted = await deleteNetwork(decodedName);
    
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Network not found" });
    }
    
    res.json({ success: true, message: "Network deleted successfully" });
  } catch (error) {
    console.error("Error deleting network:", error);
    res.status(500).json({ success: false, error: "Failed to delete network" });
  }
});

/**
 * POST /networks/migrate
 * Migrate networks from localStorage to database
 */
router.post('/migrate', async (req, res) => {
  try {
    const { networksData } = req.body;
    const migratedNetworks = await migrateNetworksFromLocalStorage(networksData);
    res.json({ 
      success: true, 
      message: `Successfully migrated ${migratedNetworks.length} networks`,
      networks: migratedNetworks 
    });
  } catch (error) {
    console.error("Error migrating networks:", error);
    res.status(500).json({ success: false, error: "Failed to migrate networks" });
  }
});

/**
 * GET /networks/count
 * Get networks count
 */
router.get('/count', async (req, res) => {
  try {
    const count = await getNetworksCount();
    res.json({ success: true, count });
  } catch (error) {
    console.error("Error getting networks count:", error);
    res.status(500).json({ success: false, error: "Failed to get networks count" });
  }
});

export default router;
