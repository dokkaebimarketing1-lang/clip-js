/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@remotion/renderer'],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

module.exports = nextConfig;
