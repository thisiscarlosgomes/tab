import path from "node:path";
export default {
  devIndicators: false,
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(process.cwd(), "../../../src"),
      "@react-native-async-storage/async-storage": path.resolve(
        process.cwd(),
        "../../../src/lib/asyncStorageShim.ts",
      ),
    };
    return config;
  },
};
