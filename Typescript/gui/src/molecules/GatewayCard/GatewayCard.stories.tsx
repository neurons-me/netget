import type { Meta, StoryObj } from '@storybook/react';
import GatewayCard from './GatewayCard';

const meta: Meta<typeof GatewayCard> = {
  title: 'Netget/Molecules/GatewayCard',
  component: GatewayCard,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof GatewayCard>;

export const Bootstrapped: Story = {
  args: {
    gatewayId:   'Suis-MacBook-Air.local',
    owner:       'a7f3b2e1d9c0f5a83e21b64c7d90f12e3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
    bootstrapped: true,
    adminCount:  1,
    scopes:      ['read', 'write', 'admin'],
    updatedAt:   new Date().toISOString(),
  },
};

export const Unclaimed: Story = {
  args: {
    gatewayId:   'my-gateway.local',
    owner:       null,
    bootstrapped: false,
    adminCount:  0,
    scopes:      [],
  },
};

export const NoScopes: Story = {
  args: {
    gatewayId:   'prod-gateway.example.com',
    owner:       'b9c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
    bootstrapped: true,
    adminCount:  3,
    scopes:      [],
    updatedAt:   new Date().toISOString(),
  },
};
