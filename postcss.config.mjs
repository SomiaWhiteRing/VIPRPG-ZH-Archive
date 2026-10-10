import tailwind from "@tailwindcss/postcss";
import { styleNamespaceCss } from "./scripts/style-namespace.mjs";

export default {
  plugins: [tailwind(), styleNamespaceCss()],
};
