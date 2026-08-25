import React, { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { mount } from 'this.gui/runtime';
import { Theme } from 'this.gui';
import 'this.gui/style.css';
import './styles.css';
import App from './App.jsx';

// Tab title reflects whichever hostname actually loaded this page
// (127.0.0.1, localhost, local.netget, ...) instead of a fixed
// "local.netget" regardless of origin — index.html's static <title> was a
// placeholder only, this is what actually wins once the app boots.
document.title = window.location.hostname;

// Bootstraps through mount() (instead of a plain createRoot().render()) so
// this app's chrome participates in the Semantic Inspector graph — see
// packages/GUI/Typescript/npx/template/src/runtime.tsx for the same pattern
// applied to the this.gui CLI template. App.jsx's router/pages are untouched
// component references here; mount() only needs to own the outermost root.
//
// this.gui's own <Theme> already wraps its children in a real MUI
// ThemeProvider + CssBaseline (see gui/Theme/Theme.tsx) — there used to be
// a second, hand-rolled MUI ThemeProvider (CustomThemeProvider, from
// context/ThemeContext.jsx) nested inside it. Nested ThemeProviders don't
// merge, the inner one wins — so every this.gui component's `sx` theme
// tokens (Namespace, Layout, ThemeLauncher, ...) had been resolving
// against that separate hand-rolled theme instead of this.gui's own the
// whole time, silently. CustomThemeProvider's only other export
// (useThemeToggle) had zero consumers anywhere in this app — removed
// outright rather than left half-wired.
const spec = {
  type: StrictMode,
  children: {
    type: Theme,
    props: { 'data-gui-component': 'Theme' },
    children: { type: App, props: { 'data-gui-component': 'App' } },
  },
};

mount(spec, '#root', {
  gui: {},
  React,
  ReactDOM,
  // inspectorToggleVisible: false — the LeftBar's own Dev Tools popover
  // (wrench icon, bottom of the rail) already has a Semantic Inspector
  // on/off toggle; this floating bottom-right button duplicated it.
  devtools: { inspector: false, inspectorToggleVisible: false },
});
