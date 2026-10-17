import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@beezops/domain-code-risk"],
  outputFileTracingIncludes: {
    "/api/expert-map": [
      "./.github/CODEOWNERS",
      "./CODEOWNERS",
      "./docs/CODEOWNERS",
    ],
  },
};

export default withWorkflow(nextConfig);
