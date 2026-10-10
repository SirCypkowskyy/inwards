/**
 * @file The seven architecture presets behind `inwards init --style`: layered,
 * clean and hexagonal, which are layers only (both turn on INW014 for their
 * ports), and vertical-slices, bounded-contexts, django and fastapi, which add
 * templates and contexts (fastapi, which also turns on the FastAPI rules, is
 * `fastapi-preset.ts`'s).
 * Each names the one import its config can't forbid (its `gap`). Pure data;
 * what a preset is lives in `styles.ts`.
 */
import { djangoModules } from "./django.ts";
import { FASTAPI } from "./fastapi-preset.ts";
import { ADAPTERS, topShape, USE_CASES } from "./shapes.ts";
import {
  BOOTSTRAP,
  contextsWhy,
  PORTS_ABSTRACT,
  runBootstrap,
  type Style,
  type StyleName,
} from "./styles.ts";

/** The fields the linear presets share: no templates, contexts or rules turned off. */
const LINEAR: Pick<
  Style,
  "templates" | "contexts" | "ignoreRules" | "optIn" | "companion" | "tryIt"
> = {
  templates: [],
  contexts: undefined,
  ignoreRules: undefined,
  optIn: undefined,
  companion: undefined,
  tryIt: runBootstrap,
};

export const STYLES: Readonly<Record<StyleName, Style>> = {
  layered: {
    ...LINEAR,
    name: "layered",
    summary: "N-tier: presentation calls services, services call persistence",
    layers: [
      { name: "domain", module: "domain", role: "entities shared by every layer" },
      { name: "persistence", module: "persistence", role: "repositories and their Protocols" },
      { name: "services", module: "services", role: "business operations (use cases)" },
      { name: "presentation", module: "presentation", role: "CLI or HTTP handlers" },
      BOOTSTRAP,
    ],
    example: {
      entity: "domain.order",
      port: "persistence.orders",
      useCase: "services.place_order",
      adapter: "persistence.in_memory_orders",
      driving: "presentation.cli",
      bootstrap: "bootstrap",
    },
    shapes: [topShape(["domain/", "persistence/", "services/", "presentation/"])],
    gap: "presentation may call persistence without going through services (open layers)",
  },
  clean: {
    ...LINEAR,
    optIn: PORTS_ABSTRACT,
    name: "clean",
    summary: "entities at the centre, use cases around them, frameworks outside",
    layers: [
      { name: "domain", module: "domain", role: "entities and business rules, no I/O" },
      { name: "application", module: "application", role: "use cases and the ports they need" },
      { name: "infrastructure", module: "infrastructure", role: "adapters that implement ports" },
      { name: "presentation", module: "presentation", role: "CLI or HTTP handlers" },
      BOOTSTRAP,
    ],
    example: {
      entity: "domain.order",
      port: "application.ports.orders",
      useCase: "application.use_cases.place_order",
      adapter: "infrastructure.in_memory_orders",
      driving: "presentation.cli",
      bootstrap: "bootstrap",
    },
    shapes: [topShape(["domain/", "application/", "infrastructure/", "presentation/"]), USE_CASES],
    gap: "presentation may import infrastructure; leave the wiring to bootstrap",
  },
  hexagonal: {
    ...LINEAR,
    optIn: PORTS_ABSTRACT,
    name: "hexagonal",
    summary: "ports and adapters: the application talks to the world only through ports",
    layers: [
      { name: "domain", module: "domain", role: "entities and business rules, no I/O" },
      { name: "application", module: "application", role: "use cases and the ports they need" },
      { name: "outbound", module: "adapters.outbound", role: "driven adapters: implement ports" },
      {
        name: "inbound",
        module: "adapters.inbound",
        role: "driving adapters: call use cases",
        sibling: true,
      },
      BOOTSTRAP,
    ],
    example: {
      entity: "domain.order",
      port: "application.ports.orders",
      useCase: "application.use_cases.place_order",
      adapter: "adapters.outbound.in_memory_orders",
      driving: "adapters.inbound.cli",
      bootstrap: "bootstrap",
    },
    shapes: [topShape(["domain/", "application/", "adapters/"]), USE_CASES, ADAPTERS],
    gap: "an inbound adapter may call a port directly instead of a use case",
  },
  "vertical-slices": {
    name: "vertical-slices",
    summary: "one package per feature, independent of each other, on a shared kernel",
    layers: [
      { name: "shared", module: "shared", role: "the shared kernel: code every slice may use" },
      { name: "features", module: "features", role: "one package per slice, each a context" },
      BOOTSTRAP,
    ],
    templates: [
      {
        name: "slice",
        why: "What every slice has in common: other code may import only its api module.",
        roles: [],
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
    optIn: undefined,
    companion: undefined,
    example: {
      entity: "features.orders.order",
      port: "features.orders.repository",
      useCase: "features.orders.place_order",
      adapter: "features.orders.in_memory_orders",
      driving: "features.orders.cli",
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
        require: ["api"],
        allow: undefined,
        extra: "error",
        why: "every slice has its public api module",
      },
    ],
    gap: "code only one slice uses may still move into shared, where every slice can reach it",
  },
  "bounded-contexts": {
    name: "bounded-contexts",
    summary: "one package per bounded context, each layered inside, crossing only through its api",
    layers: [
      {
        name: "context",
        module: "*",
        role: "every bounded context, layered by the context template",
        template: "context",
      },
      BOOTSTRAP,
    ],
    templates: [
      {
        name: "context",
        why: "The layers inside every context, innermost first, and the one module other code may import.",
        roles: [
          { name: "domain", role: "entities and business rules, no I/O" },
          { name: "application", role: "use cases and the ports they need" },
          { name: "infrastructure", role: "adapters: implement ports, drive use cases" },
          { name: "api", role: "the context's public module", file: true },
        ],
        public: ["api"],
      },
    ],
    contexts: {
      template: "context",
      parent: "",
      why: contextsWhy(
        "context package",
        "Each context package is a context: it imports another only when its depends-on names it, and then only its api.",
      ),
      names: ["orders"],
    },
    ignoreRules: undefined,
    optIn: undefined,
    companion: undefined,
    example: {
      entity: "orders.domain.order",
      port: "orders.application.ports",
      useCase: "orders.application.place_order",
      adapter: "orders.infrastructure.in_memory_orders",
      driving: "orders.infrastructure.cli",
      bootstrap: "bootstrap",
      api: "orders.api",
    },
    tryIt: runBootstrap,
    shapes: [
      {
        package: "",
        require: ["bootstrap.py"],
        allow: ["*/", "__main__.py", "_version.py"],
        extra: "error",
        why: "context packages and the composition root only; a module here would belong to no layer",
      },
      {
        package: "*",
        require: ["domain/", "application/", "infrastructure/", "api"],
        allow: [],
        extra: "warning",
        why: "the context's four layers; anything else is a warning, since no layer would hold it",
      },
    ],
    gap: "a context's api may re-export anything, its domain entities included",
  },
  django: {
    name: "django",
    summary:
      "Django apps: models, services, views and urls in each, apps crossing only through services",
    layers: [
      {
        name: "app",
        module: "*",
        role: "every Django app, layered by the django-app template; models import django.db",
        template: "django-app",
        denyLibraries: [],
      },
      {
        name: "project",
        module: "",
        role: "settings, the root URLconf, and app modules outside the roles (admin, apps)",
      },
    ],
    templates: [
      {
        name: "django-app",
        why: "The layers inside every app, innermost first, and the module other apps may import.",
        roles: [
          { name: "models", role: "the app's models", file: true },
          { name: "services", role: "business operations: the app's public module", file: true },
          { name: "views", role: "turn requests into service calls", file: true },
          { name: "urls", role: "the app's URL patterns", file: true },
        ],
        public: ["services"],
      },
    ],
    contexts: {
      template: "django-app",
      parent: "",
      why: contextsWhy(
        "app",
        "Each app is a context: other apps and the project may import only its services.",
      ),
      names: ["orders"],
    },
    ignoreRules: {
      codes: ["INW002"],
      why: "Apps may use each other's services without declaring it; INW003 keeps them to services.",
    },
    optIn: undefined,
    companion: undefined,
    example: djangoModules,
    tryIt: (pkg: string): string =>
      `uv add django && uv run django-admin check --settings ${pkg}.settings`,
    shapes: [
      {
        package: "",
        require: ["settings.py", "urls.py"],
        allow: ["*/", "asgi.py", "wsgi.py", "__main__.py", "_version.py"],
        extra: "error",
        why: "apps, settings and the URLconf only; anything else is an error",
      },
      {
        package: "*",
        require: ["models", "services", "views", "urls"],
        allow: ["admin", "apps", "migrations/", "tests"],
        extra: "warning",
        why: "the app's roles and what startapp writes; anything else is a warning",
      },
    ],
    gap: "a view may use the models directly instead of going through the services",
  },
  fastapi: FASTAPI,
};
