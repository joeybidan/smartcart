import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = resolve(process.cwd(), "js/runtime-config.js");
const config = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY ?? ""
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `/* Generated at build time. Do not commit this file. */\nwindow.SMARTCART_RUNTIME_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
  "utf8"
);

console.log(`Generated ${outputPath}`);
