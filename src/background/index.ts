import { overleafBridge, overleafOpenFile } from "@/content/overleafBridge";
import { overleafCompile } from "@/content/overleafCompile";
import type { BridgeCommand, BridgeResult } from "@/lib/overleaf";

// Clicking the toolbar icon opens the side panel.
function enablePanelOnClick() {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
chrome.runtime.onStartup.addListener(enablePanelOnClick);

interface OverleafMessage {
  type: "overleaf";
  tabId: number;
  cmd: BridgeCommand;
}

const isOverleafMessage = (m: unknown): m is OverleafMessage =>
  !!m && typeof m === "object" && (m as OverleafMessage).type === "overleaf" && typeof (m as OverleafMessage).tabId === "number" && !!(m as OverleafMessage).cmd;

/** Runs the bridge in the Overleaf tab's MAIN world, only for Overleaf project pages. */
async function runBridge(tabId: number, cmd: BridgeCommand): Promise<BridgeResult> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.startsWith("https://www.overleaf.com/project/")) {
      return { ok: false, code: "no-access", error: "That tab is no longer an Overleaf project. Pick the tab again." };
    }
    // Opening a file and compiling wait for the page, so they use async functions.
    const target = { tabId };
    const [frame] =
      cmd.op === "open"
        ? await chrome.scripting.executeScript({ target, world: "MAIN", func: overleafOpenFile, args: [cmd.name] })
        : cmd.op === "compile"
          ? await chrome.scripting.executeScript({ target, world: "MAIN", func: overleafCompile, args: [cmd.download, cmd.timeoutMs ?? 120000] })
          : await chrome.scripting.executeScript({ target, world: "MAIN", func: overleafBridge, args: [cmd] });
    return (frame?.result as BridgeResult | undefined) ?? { ok: false, code: "error", error: "The Overleaf tab returned no data." };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: "no-access",
      error: /No tab with id|Cannot access|cannot be scripted/i.test(message)
        ? "Couldn't reach that Overleaf tab. Reload the tab and try again."
        : `Couldn't talk to Overleaf: ${message}`
    };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Only our own extension pages (the side panel) may drive Overleaf.
  if (sender.id !== chrome.runtime.id || !isOverleafMessage(message)) return false;
  void runBridge(message.tabId, message.cmd).then(sendResponse);
  return true; // async response
});
