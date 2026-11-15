import path from "node:path";
import main from "../../../tailwind.config";
const config = {
  ...main,
  content: [path.resolve(process.cwd(), "../../../src/**/*.{js,ts,jsx,tsx,mdx}"), "./app/**/*.{ts,tsx}"],
};

export default config;
