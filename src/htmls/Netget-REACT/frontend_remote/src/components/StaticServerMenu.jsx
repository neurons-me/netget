import React, { useState } from "react";
import { Box, List, ListItem, ListItemButton, ListItemText, ListItemIcon, Drawer, IconButton, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import SettingsIcon from "@mui/icons-material/Settings";
import { HiServer } from "react-icons/hi";
import { useNavigate } from "react-router-dom";

const servers = [
    { id: 1, name: "Raspberry" },
    { id: 2, name: "Main Server" },
    { id: 3, name: "BongiQuackComputer" }
];

const drawerWidth = "25vw";


const StaticServerMenu = ({ onSelectServer, selectedServerId, open, setOpen }) => {
    const navigate = useNavigate();

    return (
        <>
            <Drawer
                variant="persistent"
                anchor="left"
                open={open}
                sx={{
                    //   width: drawerWidth,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': {
                        width: drawerWidth,
                        boxSizing: 'border-box',
                        background: '#232323',
                        color: '#fff',
                        borderRight: '1px solid #444',
                        zIndex: 1200,
                        display: 'flex',
                        flexDirection: 'column',
                    },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', p: 1, justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 'bold', fontSize: 18 }}>
                        <ListItemIcon sx={{ color: '#fff', minWidth: '40px' }}>
                            <HiServer size={30} />
                        </ListItemIcon>
                        Servers
                    </span>
                </Box>
                <List sx={{ flex: 1, overflow: 'auto' }}>
                    {servers.map((server) => (
                        <ListItem key={server.id} disablePadding>
                            <ListItemButton
                                selected={selectedServerId === server.id}
                                onClick={() => onSelectServer(server.id)}
                            >
                                <ListItemIcon sx={{ color: '#fff', minWidth: '40px' }}>
                                    <HiServer size={20} />
                                </ListItemIcon>
                                <ListItemText primary={server.name} />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
                <Box sx={{ marginTop: 'auto', p: 2, borderTop: '1px solid #444' }}>
                    <IconButton
                        onClick={() => navigate('/servers-config')}
                        sx={{
                            color: '#fff',
                            // width: '100%',
                            display: 'flex',
                            justifyContent: 'center',
                            '&:hover': {
                                backgroundColor: '#444',
                            },
                        }}
                    >
                        <SettingsIcon />
                        {/* <Typography variant="body2" sx={{ ml: 1 }}>Configuration</Typography> */}
                    </IconButton>
                </Box>
            </Drawer>
        </>
    );
};

export default StaticServerMenu;
