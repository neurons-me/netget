import type { Meta, StoryObj } from '@storybook/react';
import MonadCard from './MonadCard';

const meta: Meta<typeof MonadCard> = {
  title: 'Netget/Molecules/MonadCard',
  component: MonadCard,
  tags: ['autodocs'],
  argTypes: {
    trust:    { control: 'select', options: ['owner', 'admin', 'peer', 'guest'] },
    exposure: { control: 'select', options: ['loopback', 'lan', 'wan'] },
  },
};

export default meta;
type Story = StoryObj<typeof MonadCard>;

export const OwnerLoopback: Story = {
  args: {
    name: 'monad-core',
    port: 4000,
    trust: 'owner',
    exposure: 'loopback',
    lastSeenMs: Date.now() - 3000,
  },
};

export const PeerLAN: Story = {
  args: {
    name: 'media-server',
    port: 8080,
    trust: 'peer',
    exposure: 'lan',
    lastSeenMs: Date.now() - 45000,
  },
};

export const GuestWAN: Story = {
  args: {
    name: 'public-api',
    port: 443,
    trust: 'guest',
    exposure: 'wan',
    lastSeenMs: Date.now() - 120000,
  },
};

export const MeshGrid: Story = {
  name: 'Mesh Grid (multiple)',
  render: () => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <MonadCard name="monad-core"   port={4000} trust="owner" exposure="loopback" lastSeenMs={Date.now() - 2000}  />
      <MonadCard name="media-server" port={8080} trust="peer"  exposure="lan"      lastSeenMs={Date.now() - 30000} />
      <MonadCard name="public-api"   port={443}  trust="guest" exposure="wan"      lastSeenMs={Date.now() - 90000} />
      <MonadCard name="admin-panel"  port={9000} trust="admin" exposure="loopback" lastSeenMs={Date.now() - 5000}  />
    </div>
  ),
};
