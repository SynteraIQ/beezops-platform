import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: resolve(repositoryRoot, ".env.local") });
loadEnv({ path: resolve(repositoryRoot, ".env") });

const nextConfig: NextConfig = { transpilePackages: ["@beezops/database"] };

export default nextConfig;
