import { registerHooks } from "node:module";

// These ESM-only packages publish an import export but no require export.
// Node 24 supports loading their synchronous ESM; let tsx's CJS tests resolve it.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "streamdown" || specifier === "remend") {
      return nextResolve(specifier, { ...context, conditions: ["node", "import"] });
    }
    return nextResolve(specifier, context);
  },
});
