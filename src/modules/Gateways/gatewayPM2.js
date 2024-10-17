import pm2 from 'pm2';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import chalk from 'chalk';
import { loadOrCreateGConfig } from './config/gConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Manages PM2 actions for a specified gateway.
 * 
 * @param {string} gatewayName - The name of the gateway to manage.
 * @param {string} action - The action to perform (start, stop, restart, delete, status, logs).
 * @returns {Promise<string>} - A promise that resolves to a status message or logs.
 * @category Gateways
 * @subcategory Main
 * @module gatewayPM2
 */
const manageGateway = async (gatewayName, action) => {
    const config = await loadOrCreateGConfig();
    const gateway = config.gateways.find(gw => gw.name === gatewayName);

    if (!gateway) {
        return `Gateway "${gatewayName}" not found.`;
    }

    const gatewayScript = path.join(__dirname, 'startGateway.js');

    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                return reject(`PM2 connection error: ${err}`);
            }

            const handlePM2Action = (pm2Method, successMessage, errorMessage) => {
                pm2[pm2Method](gatewayName, (err, proc) => {
                    pm2.disconnect();
                    if (err) {
                        return reject(`${errorMessage}: ${err}`);
                    } else {
                        return resolve(successMessage);
                    }
                });
            };

            const startGateway = (port, fallbackPort, gatewayscript) => {
                pm2.start(
                    {
                        script: gatewayscript,
                        name: gatewayName,
                        env: { PORT: port }
                    },
                    (err, apps) => {
                        if (err) {
                            if (fallbackPort) {
                                return startGateway(fallbackPort, null, gatewayScript || gateway.script);
                            } else {
                                pm2.disconnect();
                                return reject(`Failed to start ${gatewayName} on port ${port}: ${err.message}`);
                            }
                        } else {
                            pm2.disconnect();
                            return resolve(`${gatewayName} started successfully on port ${port}.`);
                        }
                    }
                );
            };

            switch (action) {
                case 'start':
                    handlePM2Action('start', `${gatewayName} started successfully.`, `Failed to start ${gatewayName}`);
                    startGateway(gateway.port, gateway.fallbackPort, gateway.script);
                    break;
                case 'status':
                    pm2.describe(gatewayName, (err, desc) => {
                        if (err) {
                            pm2.disconnect();
                            return reject(`Failed to get status for ${gatewayName}: ${err}`);
                        } else if (desc && desc.length > 0) {
                            const statusInfo = desc[0].pm2_env;
                            const procInfo = desc[0].monit; // Contains CPU and memory usage
                            const additionalInfo = statusInfo.axm_monitor; // Contains heap and other information

                            let statusOutput = `Current status of ${gatewayName}:\n`;

                            const formatLine = (label, value) => `${label.padEnd(20, ' ')}: ${value || 'N/A'}`;

                            statusOutput += formatLine('Name', statusInfo.name) + '\n';
                            statusOutput += formatLine('PID', desc[0].pid || 'N/A') + '\n';  // Using desc[0].pid for PID
                            statusOutput += formatLine('Port', statusInfo.env.PORT || 'N/A') + '\n'; // Add port information
                            statusOutput += formatLine('Status', statusInfo.status) + '\n';
                            if (statusInfo.pm_uptime) {
                                const uptime = Date.now() - statusInfo.pm_uptime;
                                const uptimeFormatted = `${Math.floor(uptime / (1000 * 60 * 60))}h ${Math.floor((uptime / (1000 * 60)) % 60)}m`;
                                statusOutput += formatLine('Started at', new Date(statusInfo.pm_uptime).toLocaleString()) + '\n';
                                statusOutput += formatLine('Uptime', uptimeFormatted) + '\n';
                            }
                            statusOutput += formatLine('Restarts', statusInfo.restart_time) + '\n';
                            if (procInfo) {
                                statusOutput += formatLine('CPU', `${procInfo.cpu}%`) + '\n';
                                statusOutput += formatLine('Memory', `${(procInfo.memory / 1024 / 1024).toFixed(2)} MB`) + '\n';
                            }
                            if (additionalInfo) {
                                // statusOutput += formatLine('Used Heap Size', `${additionalInfo['Used Heap Size'].value} ${additionalInfo['Used Heap Size'].unit}`) + '\n';
                                // statusOutput += formatLine('Heap Usage', `${additionalInfo['Heap Usage'].value} ${additionalInfo['Heap Usage'].unit}`) + '\n';
                                // statusOutput += formatLine('Event Loop Latency', `${additionalInfo['Event Loop Latency'].value} ${additionalInfo['Event Loop Latency'].unit}`) + '\n';
                                // statusOutput += formatLine('Active Handles', additionalInfo['Active handles'].value) + '\n';
                                // statusOutput += formatLine('Active Requests', additionalInfo['Active requests'].value) + '\n';
                            }
                            statusOutput += formatLine('User', statusInfo.username) + '\n';
                            statusOutput += formatLine('Watching', statusInfo.watch ? 'Yes' : 'No') + '\n';

                            pm2.disconnect();
                            return resolve(statusOutput.trim());
                        } else {
                            pm2.disconnect();
                            return resolve(`${gatewayName} is not currently managed by PM2.`);
                        }
                    });
                    break;
                case 'logs':
                    const logPathOut = path.join(os.homedir(), `.pm2/logs/${gatewayName}-out.log`);
                    const logPathErr = path.join(os.homedir(), `.pm2/logs/${gatewayName}-error.log`);
                    fs.readFile(logPathOut, 'utf8', (err, dataOut) => {
                        if (err) {
                            dataOut = 'No output log found.';
                        }
                        fs.readFile(logPathErr, 'utf8', (err, dataErr) => {
                            if (err) {
                                dataErr = 'No error log found.';
                            }
                            const logOutput = `Logs for ${gatewayName}:\n\n--- OUT LOG ---\n${dataOut.split('\n').slice(-15).join('\n')}\n\n--- ERROR LOG ---\n${dataErr.split('\n').slice(-15).join('\n')}`;
                            pm2.disconnect();
                            return resolve(logOutput);
                        });
                    });
                    break;
                case 'stop':
                    handlePM2Action('stop', `${gatewayName} stopped successfully.`, `Failed to stop ${gatewayName}`);
                    break;
                case 'restart':
                    handlePM2Action('restart', `${gatewayName} restarted successfully.`, `Failed to restart ${gatewayName}`);
                    break;
                case 'delete':
                    handlePM2Action('delete', `${gatewayName} deleted successfully.`, `Failed to delete ${gatewayName}`);
                    break;
                default:
                    pm2.disconnect();
                    return reject('Invalid action for manageGateway');
            }
        });
    });
};

export { manageGateway };
