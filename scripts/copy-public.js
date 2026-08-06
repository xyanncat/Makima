const { cpSync, rmSync } = require("node:fs");
const { resolve } = require("node:path");

const source = resolve("src/public");
const destination = resolve("dist/public");
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
