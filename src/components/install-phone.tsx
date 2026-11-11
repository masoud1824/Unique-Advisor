import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallPhone() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iphone, setIphone] = useState(false);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    setInstalled(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
    setIphone(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed) return null;

  return (
    <section className="ua-panel mb-5 p-5">
      <h2 className="text-lg font-semibold">Install the desk on your phone</h2>
      <p className="mt-2 text-sm" style={{ color: "#5a6a7a" }}>
        Add Unique Advisor to your home screen. It opens your desk, like an app. Each advisor stays signed in only on their own phone.
      </p>
      {prompt && (
        <button
          type="button"
          className="ua-btn mt-3"
          onClick={() => {
            void prompt.prompt().then(() => setPrompt(null));
          }}
        >
          Install
        </button>
      )}
      <ol className="mt-3 grid gap-1 text-sm" style={{ color: "#243246" }}>
        {iphone ? (
          <>
            <li>1. Open this page in Safari.</li>
            <li>2. Tap the Share button.</li>
            <li>3. Tap Add to Home Screen.</li>
            <li>4. Open Unique Advisor from your home screen.</li>
          </>
        ) : (
          <>
            <li>1. Open this page in Chrome.</li>
            <li>2. Tap Install, or open the browser menu and choose Install app.</li>
            <li>3. Open Unique Advisor from your home screen.</li>
          </>
        )}
      </ol>
    </section>
  );
}
