import type { Meta, StoryObj } from '@storybook/react';
import ExposureChip from './ExposureChip';

const meta: Meta<typeof ExposureChip> = {
  title: 'Netget/Atoms/ExposureChip',
  component: ExposureChip,
  tags: ['autodocs'],
  argTypes: {
    exposure: {
      control: 'select',
      options: ['loopback', 'lan', 'wan'],
      description: 'Network reach of the monad',
    },
  },
};

export default meta;
type Story = StoryObj<typeof ExposureChip>;

export const Loopback: Story = { args: { exposure: 'loopback' } };
export const LAN: Story      = { args: { exposure: 'lan'      } };
export const WAN: Story      = { args: { exposure: 'wan'      } };

export const AllLevels: Story = {
  name: 'All Levels',
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <ExposureChip exposure="loopback" />
      <ExposureChip exposure="lan"      />
      <ExposureChip exposure="wan"      />
    </div>
  ),
};
