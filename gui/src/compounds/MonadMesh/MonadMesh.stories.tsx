import type { Meta, StoryObj } from '@storybook/react';
import MonadMesh from './MonadMesh';

// In Storybook we mock the fetch so the component renders without a real server.
const MOCK_APPS = {
  apps: [
    { id: '1', name: 'monad-core',   port: 4000, trust: 'owner', exposure: 'loopback', lastSeenMs: Date.now() - 2000  },
    { id: '2', name: 'media-server', port: 8080, trust: 'peer',  exposure: 'lan',      lastSeenMs: Date.now() - 15000 },
    { id: '3', name: 'public-api',   port: 443,  trust: 'guest', exposure: 'wan',      lastSeenMs: Date.now() - 60000 },
    { id: '4', name: 'admin-panel',  port: 9000, trust: 'admin', exposure: 'loopback', lastSeenMs: Date.now() - 4000  },
  ],
  count: 4,
};

const withMockFetch = (Story: React.ComponentType) => {
  // @ts-ignore
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify(MOCK_APPS), {
      headers: { 'Content-Type': 'application/json' },
    }));
  return <Story />;
};

const meta: Meta<typeof MonadMesh> = {
  title: 'Netget/Compounds/MonadMesh',
  component: MonadMesh,
  tags: ['autodocs'],
  decorators: [withMockFetch],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof MonadMesh>;

export const Default: Story = {
  args: { pollMs: 999999 }, // disable polling in Storybook
};

export const WithClickHandler: Story = {
  args: {
    pollMs: 999999,
    onMonadClick: (m) => alert(`Clicked: ${m.name}:${m.port}`),
  },
};
