// FrontendModeLauncher.jsx — sidebar toggle for the Main Server panel's
// frontend mode: dev (live Vite proxy, hot-reload) vs production (the
// built ~/.get/dist bundle). Same bubble+popper shape as ThemeLauncher/
// DevToolsLauncher/MeLauncher so it sits consistently in the LeftBar
// footer rail, and shares their useLauncherPopover exclusivity — opening
// this closes whichever of theirs was open, and vice versa.
//
// Talks to the real `netget frontend-mode` CLI command through the two
// HTTP routes added alongside this component (GET/POST /frontend-mode on
// the local Express backend) — never reimplements that switch logic here.
import * as React from 'react';
import { Box, Typography, Icon, useRegisterGuiNode, useLauncherPopover } from 'this.gui';
import Popper from '@mui/material/Popper';
import ClickAwayListener from '@mui/material/ClickAwayListener';

const MODE_PRODUCTION = 'local-dist';
// This app's LeftBar footer never toggles to the expanded (labeled) view —
// App.jsx fixes `initialView: 'rail'` with no expand affordance — so this
// always behaves as the icon-only rail control ThemeLauncher/
// DevToolsLauncher fall back to for that view, without needing
// LeftSidebarContext (an internal, not part of this.gui's public exports).
const isRailView = true;

function isProductionMode(mode) {
    return mode === 'local-dist' || mode === 'package-dist';
}

const FrontendModeLauncher = () => {
    const [open, setOpen] = useLauncherPopover('frontendMode');
    const [mode, setMode] = React.useState(null);
    const [pending, setPending] = React.useState(null); // mode currently being switched to, or null
    const [error, setError] = React.useState(null);
    const bubbleRef = React.useRef(null);

    useRegisterGuiNode('FrontendModeLauncher.icon', 'FrontendModeLauncherIcon');
    useRegisterGuiNode('FrontendModeLauncher.menu.devToggle', 'FrontendModeLauncherToggle');
    useRegisterGuiNode('FrontendModeLauncher.menu.productionToggle', 'FrontendModeLauncherToggle');

    const fetchMode = React.useCallback(async () => {
        try {
            const res = await fetch('/frontend-mode', { cache: 'no-store' });
            const data = await res.json().catch(() => null);
            if (data?.ok) {
                setMode(data.mode);
                setError(null);
            }
        } catch {
            // Leave `mode` as whatever it last was — a transient poll
            // failure shouldn't flip the icon to an unknown state.
        }
    }, []);

    React.useEffect(() => {
        fetchMode();
        const interval = window.setInterval(fetchMode, 10000);
        return () => window.clearInterval(interval);
    }, [fetchMode]);

    const openMenu = () => setOpen((v) => !v);

    const switchTo = async (nextMode) => {
        if (pending || nextMode === mode) return;
        setPending(nextMode);
        setError(null);
        try {
            const res = await fetch('/frontend-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: nextMode }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                throw new Error(data?.message || `${res.status}`);
            }
            setMode(data.mode);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setPending(null);
        }
    };

    const production = isProductionMode(mode);
    const iconName = production ? 'cloud_done' : 'bolt';
    const label = mode == null ? 'Frontend mode' : production ? 'Production' : 'Dev';

    return (
        <Box data-gui-inspector-control="true" sx={{ width: '100%', minWidth: 0 }}>
            <Box
                ref={bubbleRef}
                data-gui-node-id="FrontendModeLauncher.icon"
                data-gui-component="FrontendModeLauncherIcon"
                role={isRailView ? 'button' : undefined}
                tabIndex={isRailView ? 0 : undefined}
                aria-label="Open frontend mode switch"
                onMouseEnter={openMenu}
                onClick={isRailView ? openMenu : undefined}
                sx={{
                    position: 'relative',
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    cursor: isRailView ? 'pointer' : 'default',
                }}
            >
                <Box
                    sx={{
                        width: 44,
                        height: 44,
                        border: '1px solid',
                        borderColor: production ? 'success.main' : 'primary.main',
                        borderRadius: '999px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxSizing: 'border-box',
                        transition: 'border-color 120ms ease, transform 120ms ease',
                        '&:hover': { transform: 'translateY(-1px)' },
                    }}
                >
                    <Icon name={pending ? 'sync' : iconName} fontSize="1.3rem" iconColor={production ? 'success' : 'primary'} />
                </Box>
            </Box>

            <Popper
                open={open}
                anchorEl={bubbleRef.current}
                placement="right-start"
                sx={{ zIndex: (theme) => theme.zIndex.drawer + 3 }}
            >
                <ClickAwayListener onClickAway={() => setOpen(false)}>
                    <Box
                        data-gui-inspector-control="true"
                        sx={{
                            ml: 1,
                            p: 1.5,
                            minWidth: 240,
                            maxWidth: 300,
                            borderRadius: 1.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            boxShadow: 4,
                        }}
                    >
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, display: 'block', mb: 1 }}>
                            Frontend Mode
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                            {mode == null ? 'Reading current mode…' : `Currently: ${label}`}
                        </Typography>

                        <Box
                            component="button"
                            type="button"
                            data-gui-node-id="FrontendModeLauncher.menu.devToggle"
                            data-gui-component="FrontendModeLauncherToggle"
                            onClick={() => switchTo('dev')}
                            disabled={!!pending}
                            sx={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 1,
                                p: 0.75,
                                border: '1px solid',
                                borderColor: mode === 'dev' ? 'primary.main' : 'divider',
                                borderRadius: 1,
                                background: 'transparent',
                                color: 'inherit',
                                cursor: pending ? 'wait' : 'pointer',
                                opacity: pending ? 0.6 : 1,
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Icon name="bolt" fontSize="1rem" iconColor={mode === 'dev' ? 'primary' : undefined} />
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>Dev (Vite)</Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: mode === 'dev' ? 'primary.main' : 'text.secondary', fontWeight: 700 }}>
                                {pending === 'dev' ? '…' : mode === 'dev' ? 'On' : ''}
                            </Typography>
                        </Box>

                        <Box
                            component="button"
                            type="button"
                            data-gui-node-id="FrontendModeLauncher.menu.productionToggle"
                            data-gui-component="FrontendModeLauncherToggle"
                            onClick={() => switchTo(MODE_PRODUCTION)}
                            disabled={!!pending}
                            sx={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 1,
                                p: 0.75,
                                mt: 0.75,
                                border: '1px solid',
                                borderColor: production ? 'success.main' : 'divider',
                                borderRadius: 1,
                                background: 'transparent',
                                color: 'inherit',
                                cursor: pending ? 'wait' : 'pointer',
                                opacity: pending ? 0.6 : 1,
                                '&:hover': { bgcolor: 'action.hover' },
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Icon name="cloud_done" fontSize="1rem" iconColor={production ? 'success' : undefined} />
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>Production (dist)</Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: production ? 'success.main' : 'text.secondary', fontWeight: 700 }}>
                                {pending === MODE_PRODUCTION ? '…' : production ? 'On' : ''}
                            </Typography>
                        </Box>

                        {error && (
                            <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 1 }}>
                                {error}
                            </Typography>
                        )}
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1, opacity: 0.7 }}>
                            Switching regenerates the gateway config and reloads OpenResty — takes a few seconds.
                        </Typography>
                    </Box>
                </ClickAwayListener>
            </Popper>
        </Box>
    );
};

export default FrontendModeLauncher;
