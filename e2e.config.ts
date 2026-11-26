import type { E2EConfig, StepExecutor } from "e2e";
import { web } from "@e2e-dev/web";
import { claudeCode } from "@e2e-dev/acp";

const noModelCalls: StepExecutor = {
  name: "no-model-calls",
  async runStep(ctx) {
    return {
      status: "blocked",
      errorCode: "MODEL_UNAVAILABLE",
      summary: `No recording replays step "${ctx.step.instruction}", and CI makes no model call.`,
    };
  },
};

export default {
  tests: "e2e/**/*.e2e.ts",
  retries: 0,
  workers: 1,
  agents: {
    default: {
      executor: process.env.CI ? noModelCalls : claudeCode({ model: "sonnet" }),
    },
  },
  targets: [
    {
      engine: web({ viewport: { width: 1440, height: 1000 } }),
      app: {
        url: "http://127.0.0.1:28757",
        readyUrl: "http://127.0.0.1:28757/start",
        identity: "resurface-fixture",
        permissions: { "clipboard-read": "grant", "clipboard-write": "grant" },
        command: {
          executable: "node",
          args: ["ci/fixture-server.js"],
          startupTimeout: 120_000,
          shutdownTimeout: 15_000,
        },
      },
    },
  ],
} satisfies E2EConfig;
