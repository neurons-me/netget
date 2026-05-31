import React from 'react';

const NeuronsLogo = ({ width = 40, height = 40 }) => (
  <div
    style={{
      display: 'inline-block',
      width: `${width}px`,
      height: `${height}px`,
      marginRight: '8px',
      backgroundImage: 'url(/neurons.me.png)',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      animation: 'pulse 2s infinite',
      filter: 'drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.2))',
    }}
  >
    <style>
      {`
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }
      `}
    </style>
  </div>
);

export default NeuronsLogo;
