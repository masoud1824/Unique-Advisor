import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function platformSteps(agent: string) {
  if (/iPhone|iPad|iPod/i.test(agent)) {
    return ["Open this page in Safari.", "Tap the Share button.", "Tap Add to Home Screen.", "Open Unique Advisor from that icon."];
  }
  if (/Android/i.test(agent)) {
    return ["Open this page in Chrome.", "Tap the browser menu.", "Tap Install app or Add to Home screen.", "Open Unique Advisor from that icon."];
  }
  if (/Edg\//i.test(agent)) {
    return ["Open this page in Edge.", "Use the app icon in the address bar, or the browser menu, and choose Install.", "Open Unique Advisor from the installed app."];
  }
  if (/Chrome/i.test(agent)) {
    return ["Open this page in Chrome.", "Use the install icon in the address bar, or the browser menu, and choose Install.", "Open Unique Advisor from the installed app."];
  }
  return ["Open this page in your browser.", "Use the browser menu to add it to your home screen or install it as an app, if that browser offers it.", "Open Unique Advisor from that icon."];
}

export function InstallPhone() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
    setSteps(platformSteps(navigator.userAgent));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed) return null;

  return (
    <div className="ua-install-phone mb-3">
      <button type="button" className="ua-btn-line" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Close install instructions" : "Install the desk"}
      </button>
      {open && (
        <section className="ua-panel mt-2 p-4">
          <h2 className="text-base font-semibold">Install the desk</h2>
          <p className="mt-2 text-sm" style={{ color: "#5a6a7a" }}>
            This adds Unique Advisor on this device. Signing out here clears the saved desk sign-in on this browser. It does not sign out other devices.
          </p>
          <ol className="mt-3 grid list-decimal gap-1 pl-5 text-sm" style={{ color: "#243246" }}>
            {steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {prompt && (
            <button type="button" className="ua-btn mt-3" onClick={() => { void prompt.prompt().then(() => setPrompt(null)); }}>
              Install
            </button>
          )}
        </section>
      )}
    </div>
  );
}
