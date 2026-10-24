/**
 * Monaco editor, loaded on demand. Vite bundles the language workers. Only syntax is validated: without project
 * context, semantic errors would be noise. The theme follows the UI's light / dark mode.
 */
import * as monaco from "monaco-editor"
import EditorWorker from "monaco-editor/editor/editor.worker?worker"
import CssWorker from "monaco-editor/language/css/css.worker?worker"
import HtmlWorker from "monaco-editor/language/html/html.worker?worker"
import JsonWorker from "monaco-editor/language/json/json.worker?worker"
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker"

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new JsonWorker()
    if (label === "css" || label === "scss" || label === "less") return new CssWorker()
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker()
    if (label === "typescript" || label === "javascript") return new TsWorker()
    return new EditorWorker()
  },
}

const ts = (monaco as unknown as { typescript?: { typescriptDefaults: TsDefaults; javascriptDefaults: TsDefaults } })
  .typescript
type TsDefaults = {
  setDiagnosticsOptions(options: { noSemanticValidation: boolean; noSyntaxValidation: boolean }): void
}
for (const defaults of [ts?.typescriptDefaults, ts?.javascriptDefaults])
  defaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })

/**
 * UI colors for the editor background, line numbers and so on, matching tokens.css. Monaco only accepts 6-digit hex,
 * so it cannot read the minified CSS variables.
 */
const COLORS = {
  light: {
    bg: "#ffffff",
    line: "#f7f8fa",
    number: "#8f959e",
    active: "#646a73",
    selection: "#dbe7ff",
    inactive: "#edf2ff",
    cursor: "#1456f0",
    widget: "#ffffff",
    border: "#e1e3e6",
  },
  dark: {
    bg: "#1e2024",
    line: "#26292e",
    number: "#7f858f",
    active: "#b0b4ba",
    selection: "#253a63",
    inactive: "#202b44",
    cursor: "#6b9cff",
    widget: "#24272b",
    border: "#34373d",
  },
}

function define() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches
  const color = COLORS[dark ? "dark" : "light"]
  monaco.editor.defineTheme("merakcode", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": color.bg,
      "editorGutter.background": color.bg,
      "editor.lineHighlightBackground": color.line,
      "editorLineNumber.foreground": color.number,
      "editorLineNumber.activeForeground": color.active,
      "editor.selectionBackground": color.selection,
      "editor.inactiveSelectionBackground": color.inactive,
      "editorCursor.foreground": color.cursor,
      "editorWidget.background": color.widget,
      "editorWidget.border": color.border,
      "editorSuggestWidget.background": color.widget,
      "editorSuggestWidget.border": color.border,
      "editorHoverWidget.background": color.widget,
      "editorHoverWidget.border": color.border,
    },
  })
  monaco.editor.setTheme("merakcode")
}
define()
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", define)

export { monaco }
