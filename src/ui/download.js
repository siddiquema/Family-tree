// Saves text as a file in the visitor's own browser. Works in a normal browser tab; a page
// opened inside a hosted preview frame (rather than the visitor's own browser) may block the
// download the browser would otherwise start — open the file directly in a browser if so.
export function downloadText(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
