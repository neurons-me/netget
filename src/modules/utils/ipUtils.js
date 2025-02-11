//netget/modules/utils/ipUtils.js
import fetch from 'node-fetch';
import os from 'os';

/**
 * Gets the public IP address of the machine using an external API.
 * @returns {Promise<string|null>} The public IP address or null if not found.
*/
async function getPublicIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if (response.ok) {
            const data = await response.json();
            return data.ip; // Return the public IP address
        } else {
            throw new Error('Failed to retrieve IP address');
        }
    } catch (error) {
        console.error(`Error checking public IP: ${error.message}`);
        return null;  // Return null if there is an error or no public IP found
    }
}

/**
 * Gets the local IP address of the machine.
 * @returns {string|null} The local IP address or null if not found.
*/
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over non-ipv4 and internal (i.e., 127.0.0.1) addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address; // Return the first non-internal IPv4 address
            }
        }
    }
    return null;  // Return null if no suitable IP address found
}

export { getPublicIP, getLocalIP };
