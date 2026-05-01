import { globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  globalIgnores([".next/**", ".open-next/**", "out/**", "cloudflare-env.d.ts"]),
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
