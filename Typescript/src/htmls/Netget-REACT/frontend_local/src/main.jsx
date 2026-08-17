import React, { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { mount } from 'this.gui/runtime';
import { CustomThemeProvider } from './context/ThemeContext.jsx';
import { Theme } from 'this.gui';
import 'this.gui/style.css';
import './styles.css';
import App from './App.jsx';

// Bootstraps through mount() (instead of a plain createRoot().render()) so
// this app's chrome participates in the Semantic Inspector graph — see
// packages/GUI/Typescript/npx/template/src/runtime.tsx for the same pattern
// applied to the this.gui CLI template. App.jsx's router/pages are untouched
// component references here; mount() only needs to own the outermost root.
const spec = {
  type: StrictMode,
  children: {
    type: Theme,
    props: { 'data-gui-component': 'Theme' },
    children: {
      type: CustomThemeProvider,
      props: { 'data-gui-component': 'CustomThemeProvider' },
      children: { type: App, props: { 'data-gui-component': 'App' } },
    },
  },
};

mount(spec, '#root', {
  gui: {},
  React,
  ReactDOM,
  devtools: { inspector: true, inspectorToggleVisible: true },
});
