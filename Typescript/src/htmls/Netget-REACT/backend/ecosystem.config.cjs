module.exports = {
  apps: [
    {
      name: 'netget-proxy-dev',
      script: 'proxy.js',
      // proxy.js itself is plain JS, but its routes now import domainStore.ts
      // (kernel/domainStore.ts) directly — tsx transpiles that import on
      // demand. Same reasoning as frontend_local's this.gui dependency: run
      // the real source, no separate compiled-JS build step to keep in sync.
      interpreter: './node_modules/.bin/tsx',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        USE_HTTPS: false
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        USE_HTTPS: true
      },
      // Development specific settings
      watch: true,
      watch_delay: 1000,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        'env'
      ],
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Auto restart settings
      max_restarts: 10,
      min_uptime: '10s',
      // Memory settings
      max_memory_restart: '1G',
      // Source map support for debugging
      source_map_support: true,
      // Kill timeout
      kill_timeout: 5000
    }
  ]
};