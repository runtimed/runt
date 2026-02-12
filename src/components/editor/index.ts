export {
  CodeMirrorEditor,
  type CodeMirrorEditorProps,
  type CodeMirrorEditorRef,
} from "./codemirror-editor";
export {
  coreSetup,
  defaultExtensions,
  minimalExtensions,
  minimalSetup,
  notebookEditorTheme,
} from "./extensions";
export {
  detectLanguage,
  fileExtensionToLanguage,
  getLanguageExtension,
  languageDisplayNames,
  type SupportedLanguage,
} from "./languages";
export {
  darkTheme,
  documentHasDarkMode,
  getAutoTheme,
  getTheme,
  isDarkMode,
  lightTheme,
  prefersDarkMode,
  type ThemeMode,
} from "./themes";
