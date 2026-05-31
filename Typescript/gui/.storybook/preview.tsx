import React from 'react';
import type { Preview } from '@storybook/react';
import { Theme } from 'this.gui';

const preview: Preview = {
  decorators: [
    (Story) => (
      <Theme initialMode="dark">
        <div style={{ padding: '24px' }}>
          <Story />
        </div>
      </Theme>
    ),
  ],
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark',  value: '#121212' },
        { name: 'light', value: '#fafafa' },
      ],
    },
  },
};

export default preview;
