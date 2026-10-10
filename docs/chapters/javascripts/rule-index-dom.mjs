// fallow-ignore-file unused-file
// fallow-ignore-file unused-export
// Imported only by rule-index.mjs, which the docs configs load and fallow
// can't reach, so its imports look unused to fallow.
// DOM helpers for the rule browser (issue #145): they build elements from
// data with createElement and text nodes only, so nothing from rules.json is
// ever parsed as markup. rule-index.mjs imports them.

/**
 * Creates an element with attributes and children, so no markup is ever
 * parsed from data.
 *
 * @param {string} tag - the element name.
 * @param {Record<string, string>} attributes - attributes to set.
 * @param {Array<Node | string>} children - child nodes or text.
 * @returns {HTMLElement} the element.
 */
export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/**
 * Turns a summary with backtick code spans into text and `<code>` nodes.
 *
 * @param {string} text - the summary from the index table.
 * @returns {Array<Node | string>} the nodes, in order.
 */
export function inlineCode(text) {
  return text
    .split("`")
    .map((part, index) => (index % 2 === 1 ? element("code", {}, [part]) : part));
}

/**
 * Builds a labelled `<select>`.
 *
 * @param {string} name - the view key it sets.
 * @param {string} label - its visible label.
 * @param {Array<[string, string]>} options - the value and text of each option.
 * @returns {HTMLElement} the label, wrapping its text and the select.
 */
export function select(name, label, options) {
  const choices = options.map(([value, text]) => element("option", { value }, [text]));
  return element("label", { class: "inw-rules__field" }, [
    element("span", {}, [label]),
    element("select", { name }, choices),
  ]);
}
