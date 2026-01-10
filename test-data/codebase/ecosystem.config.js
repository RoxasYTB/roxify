module.exports = {
  apps: [
    {
      name: 'glados-disc',
      script: './index.js',
      instances: 1,
      exec_mode: 'fork',

      node_args: [
        '--max-old-space-size=512',
        '--gc-interval=100',
        '--optimize-for-size',
      ],

      env: {
        NODE_ENV: 'production',
        TOTAL_SHARDS: '4',
        SHARD_MEMORY_LIMIT: '256',
        DISCORD_CACHE_ENABLED: 'false',
        GC_AGGRESSIVE: 'true',
      },

      max_memory_restart: '800M',
      autorestart: true,
      watch: false,

      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      max_log_files: 3,
      log_max_size: '10M',

      kill_timeout: 5000,
      listen_timeout: 10000,
      restart_delay: 3000,

      merge_logs: true,
    },
  ],
};

