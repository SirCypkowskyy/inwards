/**
 * The interactive `inwards init` on a terminal: pick a style (its layers show
 * under the highlighted one), whether to scaffold the example, and an agent.
 * It ends by printing the equivalent command, so the next run can skip it.
 * The caller has already checked that stdin and stdout are TTYs.
 */
import {
  AGENTS,
  type Agent,
  type InitFlags,
  type InitPlan,
  type Picker,
  type Target,
} from "../init/contracts.ts";
import { drawTree, STYLE_NAMES, STYLES, type StyleName } from "../init/styles.ts";

const AGENT_HINTS: Readonly<Record<Agent, string>> = {
  claude: "hooks in .claude/settings.local.json",
  aider: "prints the lint-cmd line",
  "agents-md": "a section in AGENTS.md",
};

/**
 * Asks what to set up. On a configured project only the agent is asked,
 * since `--style` never rewrites layers.
 *
 * @param target - the pyproject.toml init works on.
 * @param flags - the options given with the picker (`--scaffold`, `--package`, `--dry-run`).
 * @returns the plan, or undefined when the user cancelled (after saying so).
 */
async function pick(target: Target, flags: InitFlags): Promise<InitPlan | undefined> {
  // Loaded here, never at start-up: only this path pays for the prompt library.
  const clack = await import("@clack/prompts");
  clack.intro("inwards init");
  let style: StyleName | undefined;
  let scaffold = false;
  if (target.configured) {
    clack.log.info(`${target.path} already has [tool.inwards]; only an agent can be added.`);
  } else {
    const pkg = target.pkg ?? "app";
    const chosen = await clack.select<StyleName>({
      message: "Architecture style (layers innermost first)",
      options: STYLE_NAMES.map((name) => ({
        value: name,
        label: name,
        hint: layerTree(name, pkg),
      })),
      initialValue: "hexagonal",
    });
    if (clack.isCancel(chosen)) {
      return cancelled(clack.cancel);
    }
    style = chosen;
    const example = await clack.confirm({
      message: "Add an example package that passes the check (--scaffold)?",
      initialValue: flags.scaffold === true,
    });
    if (clack.isCancel(example)) {
      return cancelled(clack.cancel);
    }
    scaffold = example;
  }
  const agent = await clack.select<Agent | "none">({
    message: "Wire a coding agent?",
    options: [
      { value: "none", label: "not now" },
      ...AGENTS.map((value) => ({ value, label: value, hint: AGENT_HINTS[value] })),
    ],
    initialValue: "none",
  });
  if (clack.isCancel(agent)) {
    return cancelled(clack.cancel);
  }
  const plan = { style, scaffold, agent: agent === "none" ? undefined : agent };
  clack.outro(
    plan.style === undefined && plan.agent === undefined
      ? "Nothing to set up."
      : `Same without the questions: ${equivalentCommand(plan, flags)}`,
  );
  return plan;
}

/**
 * Shows a style as the highlighted option's hint: its summary, then the tree
 * of layer packages the scaffold would create, with what each may import.
 *
 * @param name - the style.
 * @param pkg - the import package, for the tree's first line.
 * @returns the hint text.
 */
function layerTree(name: StyleName, pkg: string): string {
  const style = STYLES[name];
  const bootstrap = style.example.bootstrap.split(".");
  const tree = drawTree(style, `${pkg.replaceAll(".", "/")}/`, (parts) =>
    parts.join(".") === bootstrap.join(".") ? "file" : "dir",
  );
  return `${style.summary}\n${tree}`;
}

/**
 * Ends the picker after Ctrl-C or Escape.
 *
 * @param cancel - clack's closing line for a cancelled flow.
 * @returns undefined, the "cancelled" plan.
 */
function cancelled(cancel: (message?: string) => void): undefined {
  cancel("Cancelled; nothing was written.");
}

/**
 * Builds the command line that does what the picker chose.
 *
 * @param plan - the choices.
 * @param flags - the options given with the picker (`--package`, `--dry-run`).
 * @returns e.g. `inwards init --style hexagonal --scaffold --agent claude`.
 */
function equivalentCommand(plan: InitPlan, flags: InitFlags): string {
  return [
    "inwards init",
    plan.style === undefined ? "" : `--style ${plan.style}`,
    plan.scaffold && plan.style !== undefined ? "--scaffold" : "",
    flags.package === undefined ? "" : `--package ${flags.package}`,
    plan.agent === undefined ? "" : `--agent ${plan.agent}`,
    flags["dry-run"] === true ? "--dry-run" : "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** The picker behind the `Picker` contract. */
export const terminalPicker: Picker = { pick };
