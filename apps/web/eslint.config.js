/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Prevents "Module not found: can't resolve 'canvas'" runtime crash
    // that fabric.js triggers in Next.js server-side bundling
    config.externals.push({
      canvas: 'commonjs canvas',
    });
    return config;
  },
};

module.exports = nextConfig;