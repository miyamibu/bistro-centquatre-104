import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      ".netlify/**",
      ".next/**",
      "coverage/**",
      "next-env.d.ts",
      "node_modules/**",
      "out/**",
    ],
  },
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
      // Keep the existing UI patterns as the compatibility baseline while
      // eslint-config-next v16 enables newer React Compiler diagnostics.
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
];

export default config;
