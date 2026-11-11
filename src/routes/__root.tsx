import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { installDeskSessionFetch } from "@/lib/desk-session-client";
import { PhoneShell } from "@/components/phone-shell";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

installDeskSessionFetch();

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Unique Advisor" },
      { name: "description", content: "Plain-language notes on life insurance and related coverage, plus a way to ask a licensed advisor a question." },
      { name: "theme-color", content: "#14324f" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Unique Advisor" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,520;9..144,640&family=Outfit:wght@400;500;600&display=swap",
      },
      { rel: "manifest", href: "/advisor.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){var path=location.pathname;if(path!=="/"&&path!=="")return;if(/[?&]site=1(?:&|$)/.test(location.search))return;var ua=navigator.userAgent||"";var phone=/iPhone|iPad|iPod|Android/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);var installed=window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true;if(phone||installed)location.replace("/app");})();',
          }}
        />
        <HeadContent />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{history.scrollRestoration="manual";}catch(e){}var path=location.pathname;var site=/^\\/a\\/[^/]+\\/site\\/?$/.test(path);if(path!=="/"&&!site)return;if(location.hash)history.replaceState(history.state,"",path+location.search);scrollTo(0,0);})();',
          }}
        />
        <PreviewHostBridge />
        <PhoneShell />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
