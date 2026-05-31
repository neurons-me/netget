import type { Meta, StoryObj } from '@storybook/react';
import TrustBadge from './TrustBadge';

const meta: Meta<typeof TrustBadge> = {
  title: 'Netget/Atoms/TrustBadge',
  component: TrustBadge,
  tags: ['autodocs'],
  argTypes: {
    trust: {
      control: 'select',
      options: ['owner', 'admin', 'peer', 'guest'],
      description: 'Trust level assigned by the .me kernel',
    },
  },
};

export default meta;
type Story = StoryObj<typeof TrustBadge>;

export const Owner: Story = { args: { trust: 'owner' } };
export const Admin: Story  = { args: { trust: 'admin' } };
export const Peer: Story   = { args: { trust: 'peer'  } };
export const Guest: Story  = { args: { trust: 'guest' } };

export const AllLevels: Story = {
  name: 'All Levels',
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <TrustBadge trust="owner" />
      <TrustBadge trust="admin" />
      <TrustBadge trust="peer"  />
      <TrustBadge trust="guest" />
    </div>
  ),
};
