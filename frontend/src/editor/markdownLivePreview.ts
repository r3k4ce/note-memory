import { EditorView } from "@codemirror/view";

export const markdownLivePreviewExtension = EditorView.editorAttributes.of({
  class: "cm-markdown-live-preview",
});
