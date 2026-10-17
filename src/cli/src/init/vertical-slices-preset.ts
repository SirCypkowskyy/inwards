/**
 * @file The `vertical-slices` preset of `inwards init --style`: one package
 * per feature under `features`, on a shared kernel, each slice a context
 * layered by the `slice` template as models, services, commands and queries
 * (siblings, so neither imports the other; ADR-046) and api, with INW021
 * (private modules) on as a warning. Pure data; the example's modules come
 * from `example.ts`.
 */
import { topShape } from "./shapes.ts";
import { BOOTSTRAP, contextsWhy, runBootstrap, type Style } from "./styles.ts";

export const VERTICAL_SLICES: Style = {
  name: "vertical-slices",
  summary: "one package per feature, independent of each other, on a shared kernel",
  layers: [
    { name: "shared", module: "shared", role: "the shared kernel: code every slice may use" },
    {
      name: "slice",
      module: "features.*",
      role: "every slice, layered by the slice template",
      template: "slice",
    },
    BOOTSTRAP,
  ],
  templates: [
    {
      name: "slice",
      why: "The layers inside every slice, innermost first, and the one module other code may import.",
      roles: [
        { name: "models", role: "the slice's entities", file: true },
        { name: "services", role: "what the use cases call: ports and their adapters" },
        { name: "commands", role: "use cases that change state" },
        { name: "queries", role: "use cases that only read", sibling: true },
        { name: "api", role: "the slice's public module and driving adapter", file: true },
      ],
      public: ["api"],
    },
  ],
  contexts: {
    template: "slice",
    parent: "features",
    why: contextsWhy(
      "slice",
      "Each slice is a context: it imports another slice only when its depends-on names it, and then only that slice's api.",
    ),
    names: ["orders"],
  },
  ignoreRules: undefined,
  optIn: {
    codes: ["INW021"],
    why: "A module whose name starts with _ is imported only from inside its package (INW021), as a warning to start with: commands/ and queries/ re-export their private modules from __init__.py.",
    options: [],
  },
  companion: undefined,
  example: {
    entity: "features.orders.models",
    port: "features.orders.services.ports",
    commands: "features.orders.commands",
    queries: "features.orders.queries",
    adapter: "features.orders.services.in_memory_orders",
    driving: "features.orders.api",
    bootstrap: "bootstrap",
    api: "features.orders.api",
  },
  tryIt: runBootstrap,
  shapes: [
    topShape(["shared/", "features/"]),
    {
      package: "features",
      require: [],
      allow: ["*/"],
      extra: "error",
      why: "slice packages only; a module here would belong to no slice",
    },
    {
      package: "features.*",
      require: ["__init__", "api"],
      allow: undefined,
      extra: "error",
      why: "every slice is a regular package with its public api module",
    },
  ],
  gap: "code only one slice uses may still move into shared, where every slice can reach it",
};
