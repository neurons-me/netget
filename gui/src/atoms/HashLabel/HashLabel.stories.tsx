import type { Meta, StoryObj } from '@storybook/react';
import HashLabel from './HashLabel';

const SAMPLE_HASH = 'a7f3b2e1d9c0f5a83e21b64c7d90f12e3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d';

const meta: Meta<typeof HashLabel> = {
  title: 'Netget/Atoms/HashLabel',
  component: HashLabel,
  tags: ['autodocs'],
  args: { hash: SAMPLE_HASH },
};

export default meta;
type Story = StoryObj<typeof HashLabel>;

export const Default: Story = {};

export const ShortPrefix: Story = {
  args: { prefixLen: 6, suffixLen: 4 },
};

export const Empty: Story = {
  args: { hash: '' },
};

export const CustomFallback: Story = {
  args: { hash: '', fallback: 'not bootstrapped' },
};
