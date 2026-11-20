import { DatabaseSync } from "node:sqlite";

new DatabaseSync(":memory:").close();
await new Promise((resolve) => setImmediate(resolve));
