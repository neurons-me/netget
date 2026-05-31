import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import GatewayDashboard from './GatewayDashboard';

const MOCK_IDENTITY = {
  gatewayId:   'Suis-MacBook-Air.local',
  owner:       'a7f3b2e1d9c0f5a83e21b64c7d90f12e3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
  bootstrapped: true,
  adminCount:  1,
  scopes:      ['read', 'write', 'admin'],
  updatedAt:   new Date().toISOString(),
};

const MOCK_APPS = {
  apps: [
    { id: '1', name: 'monad-core',   port: 4000, trust: 'owner', exposure: 'loopback', lastSeenMs: Date.now() - 2000  },
    { id: '2', name: 'media-server', port: 8080, trust: 'peer',  exposure: 'lan',      lastSeenMs: Date.now() - 15000 },
    { id: '3', name: 'public-api',   port: 443,  trust: 'guest', exposure: 'wan',      lastSeenMs: Date.now() - 60000 },
  ],
  count: 3,
};

// Route mock responses based on URL
const withMockFetch = (Story: React.ComponentType) => {
  // @ts-ignore
  globalThis.fetch = (url: string) => {
    const body = url.includes('gateway-identity')
      ? JSON.stringify(MOCK_IDENTITY)
      : JSON.stringify(MOCK_APPS);
    return Promise.resolve(
      new Response(body, { headers: { 'Content-Type': 'application/json' } })
    );
  };
  return <Story />;
};

const meta: Meta<typeof GatewayDashboard> = {
  title: 'Netget/Compounds/GatewayDashboard',
  component: GatewayDashboard,
  tags: ['autodocs'],
  decorators: [withMockFetch],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof GatewayDashboard>;

export const Default: Story = {
  args: { pollMs: 999999 },
};

export const Unclaimed: Story = {
  decorators: [
    (Story) => {
      // @ts-ignore
      globalThis.fetch = (url: string) => {
        const body = url.includes('gateway-identity')
          ? JSON.stringify({ gatewayId: 'new-gateway.local', owner: null, bootstrapped: false, adminCount: 0, scopes: [] })
          : JSON.stringify({ apps: [], count: 0 });
        return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
      };
      return <Story />;
    },
  ],
  args: { pollMs: 999999 },
};
