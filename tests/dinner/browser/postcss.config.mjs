import path from "node:path";
export default {
  plugins: {
    tailwindcss: {
      config: path.resolve(process.cwd(), "tailwind.config.ts"),
    },
  },
};
