const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    sourcemap: !production,
    target: "es2022",
    ...(production && {
      minify: true,
      drop: ["debugger"],
      mangleProps: /^_private/,
      legalComments: "none",
    }),
  });

  // Bundle MCP scopes server as a standalone file
  await esbuild
    .build({
      entryPoints: ["tools/mcp-scopes/server.src.js"],
      bundle: true,
      outfile: "tools/mcp-scopes/server.js",
      format: "cjs",
      platform: "node",
      target: "es2022",
      nodePaths: [],
      ...(production && { minify: true, legalComments: "none" }),
    })
    .then(() => console.log("MCP server bundled."));

  if (watch) {
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
