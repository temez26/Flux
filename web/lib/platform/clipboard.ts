/** Puts text on the clipboard, including where the Clipboard API isn't offered. */
export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // Plain-HTTP LAN deployments have no Clipboard API.
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}
