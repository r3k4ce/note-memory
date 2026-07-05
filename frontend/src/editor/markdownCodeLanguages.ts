import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

function aliasLanguage(alias: string, languageName: string) {
  return LanguageDescription.of({
    name: alias,
    alias: [alias],
    load: () => {
      const language = LanguageDescription.matchLanguageName(languages, languageName);
      if (!language) {
        return Promise.reject(new Error(`Missing CodeMirror language data for ${languageName}`));
      }
      return language.load();
    },
  });
}

export const markdownCodeLanguages = [
  ...languages,
  aliasLanguage("py", "python"),
  aliasLanguage("md", "markdown"),
];
