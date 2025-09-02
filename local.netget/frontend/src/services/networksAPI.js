// API service for networks
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Fetch all networks from the backend
 * @returns {Promise<Array>}
 */
export const fetchNetworks = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/networks`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.networks : [];
  } catch (error) {
    console.error('Error fetching networks:', error);
    
    // Fallback to localStorage if backend is not available
    try {
      const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
      return Object.entries(storedNetworks.networks).map(([name, networkInfo]) => ({
        name,
        ...networkInfo
      }));
    } catch (localStorageError) {
      console.error('Error reading from localStorage:', localStorageError);
      return [];
    }
  }
};

/**
 * Add a new network
 * @param {Object} networkData - Network data {name, ip, owner}
 * @returns {Promise<Object>}
 */
export const addNetwork = async (networkData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/networks`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(networkData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.network;
  } catch (error) {
    console.error('Error adding network:', error);
    
    // Fallback to localStorage if backend is not available
    try {
      const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
      
      if (storedNetworks.networks[networkData.name]) {
        throw new Error("A network with this name already exists");
      }

      const newNetwork = {
        name: networkData.name,
        ip: networkData.ip,
        owner: networkData.owner,
        created_at: new Date().toISOString(),
      };

      storedNetworks.networks[networkData.name] = newNetwork;
      localStorage.setItem("networks", JSON.stringify(storedNetworks));
      
      return newNetwork;
    } catch (localStorageError) {
      throw new Error(localStorageError.message || 'Failed to add network');
    }
  }
};

/**
 * Get a specific network by name
 * @param {string} name - Network name
 * @returns {Promise<Object>}
 */
export const fetchNetworkByName = async (name) => {
  try {
    const response = await fetch(`${API_BASE_URL}/networks/${encodeURIComponent(name)}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.network : null;
  } catch (error) {
    console.error('Error fetching network:', error);
    
    // Fallback to localStorage if backend is not available
    try {
      const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
      return storedNetworks.networks[name] || null;
    } catch (localStorageError) {
      console.error('Error reading from localStorage:', localStorageError);
      return null;
    }
  }
};

/**
 * Update a network
 * @param {string} name - Current network name
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
export const updateNetwork = async (name, updates) => {
  try {
    const response = await fetch(`${API_BASE_URL}/networks/${encodeURIComponent(name)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.network;
  } catch (error) {
    console.error('Error updating network:', error);
    
    // Fallback to localStorage if backend is not available
    try {
      const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
      
      if (!storedNetworks.networks[name]) {
        throw new Error("Network not found");
      }

      // Update the network
      storedNetworks.networks[name] = {
        ...storedNetworks.networks[name],
        ...updates,
        updated_at: new Date().toISOString()
      };

      // If name is being changed, move the network to the new key
      if (updates.name && updates.name !== name) {
        storedNetworks.networks[updates.name] = storedNetworks.networks[name];
        delete storedNetworks.networks[name];
      }

      localStorage.setItem("networks", JSON.stringify(storedNetworks));
      
      return storedNetworks.networks[updates.name || name];
    } catch (localStorageError) {
      throw new Error(localStorageError.message || 'Failed to update network');
    }
  }
};

/**
 * Delete a network
 * @param {string} name - Network name
 * @returns {Promise<boolean>}
 */
export const deleteNetwork = async (name) => {
  try {
    const response = await fetch(`${API_BASE_URL}/networks/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return false;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('Error deleting network:', error);
    
    // Fallback to localStorage if backend is not available
    try {
      const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
      
      if (!storedNetworks.networks[name]) {
        return false;
      }

      delete storedNetworks.networks[name];
      localStorage.setItem("networks", JSON.stringify(storedNetworks));
      
      return true;
    } catch (localStorageError) {
      console.error('Error deleting from localStorage:', localStorageError);
      return false;
    }
  }
};

/**
 * Migrate networks from localStorage to backend database
 * @returns {Promise<Array>}
 */
export const migrateNetworksFromLocalStorage = async () => {
  try {
    const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
    
    if (Object.keys(storedNetworks.networks).length === 0) {
      return [];
    }

    const response = await fetch(`${API_BASE_URL}/networks/migrate`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ networksData: storedNetworks }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Clear localStorage after successful migration
    if (data.success) {
      localStorage.removeItem("networks");
    }
    
    return data.networks || [];
  } catch (error) {
    console.error('Error migrating networks:', error);
    return [];
  }
};

/**
 * Get networks count
 * @returns {Promise<number>}
 */
export const getNetworksCount = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/networks/count`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.count : 0;
  } catch (error) {
    console.error('Error getting networks count:', error);
    
    // Fallback to localStorage if backend is not available
    try {
      const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
      return Object.keys(storedNetworks.networks).length;
    } catch (localStorageError) {
      console.error('Error reading from localStorage:', localStorageError);
      return 0;
    }
  }
};
