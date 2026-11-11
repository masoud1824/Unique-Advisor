import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { CARDS, personalize } from "@/lib/catalog";
import { browserPublicUrl } from "@/lib/preview-path-prefix";
import {
  addAdvisorTag,
  addContactLog,
  archiveMessages,
  beginMicrosoftConnect,
  deleteContact,
  deleteContacts,
  deleteAllContacts,
  disconnectMicrosoft,
  getMailSettings,
  listTemplates,
  listCatalogCards,
  listContactLogs,
  listDrips,
  loadDesk,
  importContacts,
  previewContactSheet,
  removeCard,
  saveCard,
  saveContact,
  searchDeskContacts,
  saveDrip,
  startDrip,
  deleteDrip,
  saveMailSettings,
  saveMicrosoftApp,
  sendTestEmail,
  signOutDesk,
} from "@/lib/advisor.functions";
import { getPublicSite, saveAdvisorIdentity, saveAdvisorWebsite } from "@/lib/site.functions";
import { allowsCustom, PLAN_LABELS } from "@/lib/site-types";
import { PRODUCT_OPTIONS } from "@/lib/contact-records";
import { contactMatchesQuery } from "@/lib/contact-match";
import { clearPhoneLogin, readPhoneLogin, savePhoneLogin } from "@/lib/phone-app";
import { clearDeskToken, installDeskSessionFetch, readDeskToken, saveDeskToken } from "@/lib/desk-session-client";

installDeskSessionFetch();
import { AssistantDesk } from "@/components/assistant-desk";
import { InstallPhone } from "@/components/install-phone";
import { ConnectionsDesk } from "@/components/connections-desk";
import { AdvisorTimeZone } from "@/components/advisor-time-zone";
import { EletterDesk } from "@/components/eletter-desk";
import { NewsletterDesk } from "@/components/newsletter-desk";
import { UsefulLinks } from "@/components/useful-links";
import { cancelAdvisorMeeting, loadUpcomingMeetings } from "@/lib/advisor-links.functions";
import { msUntilZoneMidnight, onDeskDays, formatMeetingSpan } from "@/lib/meeting-time";
import { turnPhoto } from "@/lib/turn-photo";
import { DRIP_INTERVALS, dripLabel, readDripPack } from "@/lib/drips";
import { ELETTER_DESIGNS, ELETTER_SWATCH, renderEletter } from "@/lib/eletter";
import { isWebsiteLine, websiteHref } from "@/lib/advisor-website";
import { NEWSLETTER_DESIGNS } from "@/lib/newsletter";
import { WebsiteDesk } from "@/components/website-desk";
import { CalendarDesk } from "@/components/calendar-desk";
import { SupportDesk } from "@/components/support-desk";
import { FileDrop } from "@/components/file-drop";
import { DeskNotices } from "@/components/desk-notices";

export const Route = createFileRoute("/a/$slug/desk")({
  loader: ({ params }) => getPublicSite({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `Desk · ${loaderData.practiceName}` : "Desk" }] }),
  component: DeskPage,
});

var WASH = {
	birthday: "linear-gradient(135deg,#5b2a86,#c4b5fd)",
	thankyou: "linear-gradient(135deg,#0a3a66,#7eb6e8)",
	holiday: "linear-gradient(135deg,#7a1f2b,#e8b4b8)",
	welcome: "linear-gradient(135deg,#0d7a4f,#9ddec0)",
	anniversary: "linear-gradient(135deg,#b8860b,#f3e2a7)"
};
function shrinkCardPhoto(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const scale = Math.min(1, 1e3 / Math.max(img.width, img.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(img.width * scale));
			canvas.height = Math.max(1, Math.round(img.height * scale));
			const ctx = canvas.getContext("2d");
			URL.revokeObjectURL(url);
			if (!ctx) {
				reject(/* @__PURE__ */ new Error("Could not read that picture."));
				return;
			}
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			resolve(canvas.toDataURL("image/jpeg", .82));
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(/* @__PURE__ */ new Error("Choose a JPG or PNG picture."));
		};
		img.src = url;
	});
}
function DeskPage() {
	const site = Route.useLoaderData();
	if (!site) return /* @__PURE__ */ jsx("main", {
		className: "mx-auto max-w-lg px-6 py-24",
		children: /* @__PURE__ */ jsx("h1", {
			className: "text-3xl font-semibold",
			children: "This practice is not on this host."
		})
	});
	if (site.status === "suspended") return /* @__PURE__ */ jsxs("main", {
		className: "mx-auto max-w-lg px-6 py-24",
		children: [/* @__PURE__ */ jsx("h1", {
			className: "text-3xl font-semibold",
			children: "Paused"
		}), /* @__PURE__ */ jsxs("p", {
			className: "mt-3 text-[#5a6a7a]",
			children: [site.practiceName, " cannot open the desk until the operator turns it back on."]
		})]
	});
	return /* @__PURE__ */ jsx(DeskGate, {
		slug: site.slug,
		practiceName: site.practiceName
	});
}
function DeskGate({ slug, practiceName }) {
	const [code, setCode] = useState("");
	const [desk, setDesk] = useState(null);
	const [error, setError] = useState("");
	async function unlock(next) {
		setError("");
		const result = await loadDesk({ data: {
			slug,
			code: next
		} });
		if (!result.ok) {
			setError(result.error);
			sessionStorage.removeItem(`ua:${slug}`);
			clearPhoneLogin(slug);
			clearDeskToken(slug);
			return;
		}
		savePhoneLogin({
			slug,
			code: next
		});
		if (result.sessionToken) saveDeskToken(slug, result.sessionToken);
		setCode(next);
		setDesk(result.desk);
	}
	useEffect(() => {
		let alive = true;
		const saved = sessionStorage.getItem(`ua:${slug}`) || (readPhoneLogin()?.slug === slug ? readPhoneLogin()?.code : "");
		const token = readDeskToken(slug);
		void loadDesk({
			data: { slug, code: saved || "" },
			headers: token ? { "x-ua-desk": token } : undefined
		}).then((result) => {
			if (!alive) return;
			if (result?.ok) {
				if (result.sessionToken) saveDeskToken(slug, result.sessionToken);
				if (saved) setCode(saved);
				setDesk(result.desk);
			}
		}).catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [slug]);
	async function reload() {
		const result = await loadDesk({ data: {
			slug,
			code
		} });
		if (result.ok) setDesk(result.desk);
	}
	if (!desk) return /* @__PURE__ */ jsx("div", {
		className: "ua-auth",
		children: /* @__PURE__ */ jsxs("form", {
			className: "ua-auth-card",
			onSubmit: (event) => {
				event.preventDefault();
				unlock(code);
			},
			children: [
				/* @__PURE__ */ jsx("h1", { children: practiceName }),
				/* @__PURE__ */ jsx("p", {
					className: "subtitle",
					children: "Advisor desk"
				}),
				/* @__PURE__ */ jsxs("label", { children: ["Access code", /* @__PURE__ */ jsx("input", {
					type: "password",
					value: code,
					onChange: (event) => setCode(event.target.value),
					required: true
				})] }),
				error && /* @__PURE__ */ jsx("p", {
					className: "ua-auth-error",
					children: error
				}),
				/* @__PURE__ */ jsx("button", {
					type: "submit",
					children: "Open desk"
				})
			]
		})
	});
	return /* @__PURE__ */ jsx(DeskApp, {
		code,
		desk,
		reload,
		signOut: () => {
			clearPhoneLogin(slug);
			clearDeskToken(slug);
			void signOutDesk().finally(() => {
				setCode("");
				setDesk(null);
			});
		}
	});
}
function DeskApp({ code, desk, reload, signOut }) {
	const [tab, setTab] = useState(() => {
		if (typeof window === "undefined") return "dashboard";
		return new URLSearchParams(window.location.search).get("mail") || new URLSearchParams(window.location.search).get("zoom") ? "settings" : "dashboard";
	});
	const [toast, setToast] = useState("");
	const [talking, setTalking] = useState(false);
	const [voicing, setVoicing] = useState(false);
	const [spoken, setSpoken] = useState(null);
	const [assistFrom, setAssistFrom] = useState(null);
	const titles = {
		dashboard: "Dashboard",
		calendar: "Calendar",
		contacts: "Contacts",
		cards: "E-Cards",
		letters: "E-Newsletters",
		eletters: "E-Letters",
		drips: "Drip Campaigns",
		links: "Useful Links",
		support: "Support",
		assistant: "AI assistant",
		website: "Website",
		pricing: "Pricing",
		settings: "Settings",
		profile: "Profile"
	};
	const ai = desk.plan !== "starter";
	const nav = [
		["dashboard", "Dashboard"],
		["calendar", "Calendar"],
		...ai ? [["assistant", "AI assistant"]] : [],
		["contacts", "Contacts"],
		["cards", "E-Cards"],
		["letters", "E-Newsletters"],
		["eletters", "E-Letters"],
		["drips", "Drip Campaigns"],
		["links", "Useful Links"],
		["support", "Support"],
		["website", "Website"],
		["pricing", "Pricing"],
		["settings", "Settings"],
		["profile", "Profile"]
	];
	const [freshChat, setFreshChat] = useState(0);
	const [voiceCue, setVoiceCue] = useState(0);
	const [meetings, setMeetings] = useState([]);
	const [meetingZone, setMeetingZone] = useState("America/Toronto");
	const [dayTick, setDayTick] = useState(0);
	useEffect(() => {
		let timer = 0;
		let gone = false;
		const load = () => {
			void loadUpcomingMeetings({ data: { slug: desk.slug, code } }).then((result) => {
				if (gone || !result?.ok) return;
				setMeetings(result.meetings);
				const zone = result.timeZone || "America/Toronto";
				setMeetingZone(zone);
				window.clearTimeout(timer);
				timer = window.setTimeout(() => {
					setDayTick((value) => value + 1);
					load();
				}, msUntilZoneMidnight(new Date(), zone));
			}).catch(() => undefined);
		};
		const onFocus = () => load();
		const onVisible = () => {
			if (document.visibilityState === "visible") load();
		};
		load();
		window.addEventListener("ua-meetings", load);
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			gone = true;
			window.clearTimeout(timer);
			window.removeEventListener("ua-meetings", load);
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [code, desk.slug]);
	const shownMeetings = meetings.filter((meeting) => dayTick >= 0 && Boolean(meeting.start) && onDeskDays(new Date(meeting.start), new Date(), meetingZone));
	function ping(text) {
		setToast(text);
		window.setTimeout(() => setToast(""), 2800);
	}
	function talk() {
		setAssistFrom({ page: titles[tab] || "Desk", id: Date.now() });
		setTab("assistant");
		window.setTimeout(() => document.getElementById("ai-assistant-chat")?.scrollIntoView({ block: "start" }), 60);
	}
	function voiceCommand() {
		setTab("assistant");
		setVoiceCue(Date.now());
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "ua-desk md:flex",
		children: [
			/* @__PURE__ */ jsxs("aside", {
				className: "ua-side md:fixed md:inset-y-0 md:flex md:w-[260px] md:flex-col md:overflow-hidden",
				children: [/* @__PURE__ */ jsx("div", {
					className: "ua-logo shrink-0",
					style: {
						background: "#fff",
						padding: "12px 16px",
						borderRadius: 8,
						margin: "16px 16px 12px"
					},
					children: /* @__PURE__ */ jsx("img", {
						src: "/logo.png",
						alt: "Unique Advisor",
						style: {
							height: 52,
							width: "auto",
							display: "block",
							margin: "0 auto"
						}
					})
				}), /* @__PURE__ */ jsx("nav", {
					className: "ua-nav flex overflow-x-auto md:block md:min-h-0 md:flex-1 md:overflow-y-auto md:pb-6",
					children: nav.map(([id, label]) => /* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => setTab(id),
						className: `ua-navbtn ${tab === id ? "active" : ""}`,
						children: /* @__PURE__ */ jsx("span", { children: label })
					}, id))
				})]
			}),
			/* @__PURE__ */ jsxs("main", {
				className: "min-w-0 flex-1 px-5 py-6 md:ml-[260px] md:px-10 md:py-8",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "sticky top-0 z-20 -mx-5 mb-5 flex items-center gap-2 bg-[#f7f9fc] px-5 py-3 md:-mx-10 md:px-10",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							style: {
								background: "#c9a227",
								color: "#1c1915"
							},
							onClick: talk,
							children: "AI assistant"
						}), ai && /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							style: {
								background: talking ? "#b42318" : "#0f4c81"
							},
							onClick: voiceCommand,
							children: talking ? "Stop voice" : "Voice command"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line",
							onClick: () => {
								setTab("assistant");
								setFreshChat(Date.now());
							},
							children: "New chat"
						})]
					}),
					/* @__PURE__ */ jsx(InstallPhone, {}),
					/* @__PURE__ */ jsx(DeskNotices, { code, slug: desk.slug }),
					/* @__PURE__ */ jsxs("div", {
						className: "mb-7 flex flex-wrap items-center justify-between gap-3",
						children: [
							/* @__PURE__ */ jsx("h1", {
								className: "text-3xl font-bold",
								children: titles[tab]
							}),
							/* @__PURE__ */ jsx("span", {
								className: "rounded-full px-3 py-1.5 text-sm font-semibold",
								style: {
									background: "#e8f4fd",
									color: "#0f4c81"
								},
								children: PLAN_LABELS[desk.plan]
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn-line",
								onClick: () => signOut(),
								children: "Sign out"
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn",
								style: {
									background: "#c9a227",
									color: "#0a3a66"
								},
								onClick: () => setTab("pricing"),
								children: "Upgrade Plan"
							})
						]
					}),
					tab === "dashboard" && /* @__PURE__ */ jsx(Dashboard, {
						code,
						desk,
						go: setTab,
						meetings: shownMeetings,
						zone: meetingZone
					}),
					tab === "calendar" && /* @__PURE__ */ jsx(CalendarDesk, {
						code,
						slug: desk.slug,
						ping
					}),
					tab === "contacts" && /* @__PURE__ */ jsx(ContactsTab, {
						code,
						desk,
						reload,
						ping
					}),
					tab === "cards" && /* @__PURE__ */ jsx(CardsTab, {
						code,
						desk,
						reload,
						ping
					}),
					tab === "letters" && /* @__PURE__ */ jsx(NewsletterDesk, {
						code,
						desk,
						reload,
						ping
					}),
					tab === "eletters" && /* @__PURE__ */ jsx(EletterDesk, {
						code,
						desk,
						reload,
						ping
					}),
					tab === "drips" && /* @__PURE__ */ jsx(DripsTab, {
						code,
						desk,
						ping
					}),
					tab === "links" && /* @__PURE__ */ jsx(UsefulLinks, {
						code,
						slug: desk.slug,
						ping
					}),
					tab === "support" && /* @__PURE__ */ jsx(SupportDesk, {
						code,
						slug: desk.slug
					}),
					tab === "assistant" && ai && /* @__PURE__ */ jsx(AssistantDesk, {
						code,
						desk,
						spoken,
						assistFrom,
						freshChat,
						voiceCue,
						hearing: talking,
						onVoice: (status) => {
							setTalking(status.listening);
							setVoicing(status.speaking);
						},
						onOpenSettings: () => setTab("settings")
					}),
					tab === "assistant" && !ai && /* @__PURE__ */ jsxs("section", {
						className: "ua-panel p-6",
						children: [/* @__PURE__ */ jsx("h2", {
							className: "text-lg font-semibold",
							children: "AI assistant"
						}), /* @__PURE__ */ jsx("p", {
							className: "mt-2",
							style: { color: "#5a6a7a" },
							children: "Starter includes e-cards, newsletters, and drip campaigns. The AI assistant is on Professional and Team."
						})]
					}),
					tab === "website" && /* @__PURE__ */ jsx(WebsiteDesk, {
						code,
						desk,
						ping,
						reload
					}),
					tab === "pricing" && /* @__PURE__ */ jsx(PricingTab, {}),
					tab === "settings" && /* @__PURE__ */ jsx(SettingsTab, {
						code,
						desk,
						ping,
						reload
					}),
					tab === "profile" && /* @__PURE__ */ jsx(ProfileTab, {
						code,
						desk,
						ping
					})
				]
			}),
			toast && /* @__PURE__ */ jsx("div", {
				className: "fixed right-6 bottom-6 z-50 rounded-lg bg-[#0d7a4f] px-5 py-3 text-sm text-white shadow-lg",
				children: toast
			})
		]
	});
}
function Dashboard({ code, desk, go, meetings, zone }) {
	const [cancelId, setCancelId] = useState("");
	const [notifyClient, setNotifyClient] = useState(true);
	const [cancelBusy, setCancelBusy] = useState(false);
	const [cancelNote, setCancelNote] = useState("");
	async function removeMeeting(id: string) {
		setCancelBusy(true);
		setCancelNote("");
		const meeting = meetings.find((item: { id: string; join?: string }) => item.id === id);
		const zoom = Boolean(meeting?.join?.startsWith("https://"));
		const result = await cancelAdvisorMeeting({ data: { slug: desk.slug, code, meetingId: id, notify: zoom ? notifyClient : false } }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : "The meeting could not be cancelled." }));
		setCancelBusy(false);
		if (!result?.ok) {
			setCancelNote(result?.error || "The meeting could not be cancelled.");
			return;
		}
		setCancelId("");
		setCancelNote(result.warning || "Meeting cancelled.");
		window.dispatchEvent(new Event("ua-meetings"));
	}
	const cards = desk.messages.filter((message) => message.kind === "card").length;
	const letters = desk.messages.filter((message) => message.kind === "letter").length;
	const stats = [
		[desk.contacts.length, "Contacts"],
		[cards, "E-cards archived"],
		[letters, "Newsletters archived"],
		[PLAN_LABELS[desk.plan], "Plan"]
	];
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mb-6 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Today & Tomorrow"
				}),
				cancelNote ? /* @__PURE__ */ jsx("p", {
					className: "mt-2 text-sm font-semibold",
					style: { color: cancelNote.startsWith("Meeting cancelled") ? "#0d7a4f" : "#b42318" },
					children: cancelNote
				}) : null,
				meetings.length === 0 ? /* @__PURE__ */ jsx("p", {
					className: "mt-3 text-sm",
					style: { color: "#5a6a7a" },
					children: "No upcoming meetings."
				}) : /* @__PURE__ */ jsx("ul", {
					className: "mt-3",
					children: meetings.map((meeting: { id: string; when: string; time: string; schedule?: string; minutes?: number; start?: string; client: string; title: string; join: string }) => {
						const schedule = formatMeetingSpan(new Date(meeting.start || ""), Number(meeting.minutes) || 30, zone || "America/Toronto") || meeting.schedule || meeting.when || meeting.time;
						return /* @__PURE__ */ jsxs("li", {
						className: "flex flex-wrap items-center gap-3 border-b py-3 text-sm",
						style: { borderColor: "#e1e8ef" },
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "min-w-[220px] font-semibold",
								children: schedule
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "min-w-0 flex-1",
								children: [
									/* @__PURE__ */ jsx("strong", { children: meeting.client }),
									/* @__PURE__ */ jsx("span", {
										className: "block",
										style: { color: "#5a6a7a" },
										children: meeting.title
									})
								]
							}),
							(meeting.join || "").startsWith("https://") && cancelId !== meeting.id ? /* @__PURE__ */ jsx("a", {
								className: "ua-btn",
								href: meeting.join,
								target: "_blank",
								rel: "noreferrer",
								children: "Join Zoom"
							}) : null,
							cancelId === meeting.id ? /* @__PURE__ */ jsxs("div", {
								className: "grid gap-2",
								children: [
									/* @__PURE__ */ jsx("p", {
										className: "font-semibold",
										children: "Cancel this meeting?"
									}),
									(meeting.join || "").startsWith("https://") ? /* @__PURE__ */ jsxs("label", {
										className: "flex items-center gap-2",
										children: [
											/* @__PURE__ */ jsx("input", {
												type: "checkbox",
												checked: notifyClient,
												onChange: (event: { target: { checked: boolean } }) => setNotifyClient(event.target.checked)
											}),
											"Email the client a cancellation notice"
										]
									}) : null,
									/* @__PURE__ */ jsxs("div", {
										className: "flex gap-2",
										children: [
											/* @__PURE__ */ jsx("button", {
												type: "button",
												className: "ua-btn",
												disabled: cancelBusy,
												onClick: () => void removeMeeting(meeting.id),
												children: cancelBusy ? "Cancelling…" : "Cancel meeting"
											}),
											/* @__PURE__ */ jsx("button", {
												type: "button",
												className: "ua-btn-line",
												disabled: cancelBusy,
												onClick: () => setCancelId(""),
												children: "Keep"
											})
										]
									})
								]
							}) : /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn-line",
								onClick: () => {
									setCancelId(meeting.id);
									setNotifyClient(true);
									setCancelNote("");
								},
								children: "Remove"
							})
						]
					}, meeting.id);
					})
				})
			]
		}),
		/* @__PURE__ */ jsx("div", {
			className: "grid gap-4 sm:grid-cols-2 xl:grid-cols-4",
			children: stats.map(([num, label]) => /* @__PURE__ */ jsxs("div", {
				className: "ua-stat",
				children: [/* @__PURE__ */ jsx("b", { children: num }), /* @__PURE__ */ jsx("div", {
					className: "mt-1 text-sm",
					style: { color: "#5a6a7a" },
					children: label
				})]
			}, label))
		}),
		/* @__PURE__ */ jsxs("div", {
			className: "mt-6 grid gap-6 lg:grid-cols-2",
			children: [/* @__PURE__ */ jsxs("section", {
				className: "ua-panel p-6",
				children: [/* @__PURE__ */ jsx("h2", {
					className: "mb-4 text-lg font-semibold",
					children: "Recent activity"
				}), desk.messages.length === 0 ? /* @__PURE__ */ jsx("p", {
					className: "text-sm",
					style: { color: "#5a6a7a" },
					children: "Nothing sent yet."
				}) : /* @__PURE__ */ jsx("ul", { children: desk.messages.slice(0, 6).map((message) => /* @__PURE__ */ jsxs("li", {
					className: "border-b py-3 text-sm",
					style: { borderColor: "#e1e8ef" },
					children: [
						/* @__PURE__ */ jsx("strong", { children: message.kind === "card" ? "E-Card" : "Newsletter" }),
						" · ",
						message.title,
						/* @__PURE__ */ jsx("span", {
							className: "block",
							style: { color: "#5a6a7a" },
							children: message.contactName
						})
					]
				}, message.id)) })]
			}), /* @__PURE__ */ jsxs("section", {
				className: "ua-panel p-6",
				children: [/* @__PURE__ */ jsx("h2", {
					className: "mb-4 text-lg font-semibold",
					children: "Quick actions"
				}), /* @__PURE__ */ jsxs("div", {
					className: "flex flex-wrap gap-2",
					children: [
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							onClick: () => go("contacts"),
							children: "Add Contact"
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							onClick: () => go("cards"),
							children: "Send E-Card"
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							onClick: () => go("letters"),
							children: "Create Newsletter"
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							onClick: () => go("eletters"),
							children: "Write E-Letter"
						})
					]
				})]
			})]
		})
	] });
}
function ContactsTab({ code, desk, reload, ping }) {
	const [query, setQuery] = useState("");
	const [tag, setTag] = useState("");
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(null);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [birthday, setBirthday] = useState("");
	const [products, setProducts] = useState([]);
	const [productNote, setProductNote] = useState("");
	const [kycOn, setKycOn] = useState("");
	const [logs, setLogs] = useState([]);
	const [logNote, setLogNote] = useState("");
	const [picked, setPicked] = useState([]);
	const [extra, setExtra] = useState("");
	const [error, setError] = useState("");
	const [sheet, setSheet] = useState(null);
	const [sheetFile, setSheetFile] = useState("");
	const [columns, setColumns] = useState({
		name: -1,
		last: -1,
		email: -1,
		phone: -1,
		tags: -1
	});
	const [chosenIds, setChosenIds] = useState([]);
	const [pendingDelete, setPendingDelete] = useState(null);
	const [found, setFound] = useState<any[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [searchError, setSearchError] = useState("");
	useEffect(() => {
		const q = query.trim();
		if (!q) {
			setFound(null);
			setSearching(false);
			setSearchError("");
			return;
		}
		setSearching(true);
		setSearchError("");
		let stop = false;
		const timer = setTimeout(() => {
			searchDeskContacts({ data: {
				slug: desk.slug,
				code,
				query: q
			} }).then((result) => {
				if (stop) return;
				setSearching(false);
				if (!result?.ok) {
					setFound([]);
					setSearchError(result?.error || "Search failed.");
					return;
				}
				const contacts = (result.contacts || []).map((contact) => ({
					...contact,
					fullName: contact.fullName || contact.full_name || "",
					email: contact.email || "",
					phone: contact.phone || "",
					birthday: contact.birthday || "",
					kycOn: contact.kycOn || contact.kyc_on || "",
					tags: Array.isArray(contact.tags) ? contact.tags : String(contact.tags || "").split(",").map((item) => item.trim()).filter(Boolean)
				}));
				setFound(contacts);
			}).catch(() => {
				if (stop) return;
				setSearching(false);
				setFound([]);
				setSearchError("Search failed.");
			});
		}, 150);
		return () => {
			stop = true;
			clearTimeout(timer);
		};
	}, [query, desk.slug, code]);
	const tagChoices = [.../* @__PURE__ */ new Set([...desk.tags, ...desk.contacts.flatMap((contact) => contact.tags || []), ...(found || []).flatMap((contact) => contact.tags || [])])];
	function startNew() {
		setEditing(null);
		setName("");
		setEmail("");
		setPhone("");
		setBirthday("");
		setProducts([]);
		setProductNote("");
		setKycOn("");
		setLogs([]);
		setLogNote("");
		setPicked([]);
		setExtra("");
		setError("");
		setOpen(true);
	}
	function startEdit(contact) {
		setEditing(contact.id);
		setName(contact.fullName);
		setEmail(contact.email);
		setPhone(contact.phone);
		setBirthday(contact.birthday || "");
		setProducts(contact.products || []);
		setProductNote(contact.productNote || "");
		setKycOn(contact.kycOn || "");
		setLogs([]);
		setLogNote("");
		setPicked(contact.tags);
		setExtra("");
		setError("");
		setOpen(true);
		listContactLogs({ data: {
			slug: desk.slug,
			code,
			id: contact.id
		} }).then((result) => {
			if (result.ok && result.logs) setLogs(result.logs);
		});
	}
	async function onSubmit(event) {
		event.preventDefault();
		const tags = extra.trim() ? [...picked, extra.trim()] : picked;
		const result = await saveContact({ data: {
			slug: desk.slug,
			code,
			id: editing ?? void 0,
			fullName: name,
			email,
			phone,
			birthday,
			products,
			productNote,
			kycOn,
			tags
		} });
		if (!result.ok) {
			setError(result.error);
			return;
		}
		setOpen(false);
		ping(editing ? "Contact updated" : "Contact added");
		await reload();
	}
	const source = found || desk.contacts;
	const rows = source.filter((contact) => {
		if (found) return true;
		if (tag && !(contact.tags || []).includes(tag)) return false;
		return contactMatchesQuery({
			fullName: contact.fullName,
			email: contact.email,
			phone: contact.phone,
			tags: contact.tags
		}, query);
	});
	const allChecked = rows.length > 0 && rows.every((contact) => chosenIds.includes(contact.id));
	function toggleOne(id) {
		setChosenIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
	}
	function toggleAll() {
		setChosenIds((current) => {
			if (allChecked) return current.filter((id) => !rows.some((contact) => contact.id === id));
			return [.../* @__PURE__ */ new Set([...current, ...rows.map((contact) => contact.id)])];
		});
	}
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "mb-5 flex flex-wrap items-center justify-between gap-3",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "flex flex-wrap gap-2",
				children: [/* @__PURE__ */ jsx("input", {
					value: query,
					onChange: (event) => setQuery(event.target.value),
					placeholder: "Search contacts...",
					className: "ua-field ua-grow"
				}), /* @__PURE__ */ jsxs("select", {
					value: tag,
					onChange: (event) => setTag(event.target.value),
					className: "ua-field w-auto",
					children: [/* @__PURE__ */ jsx("option", {
						value: "",
						children: "All Tags"
					}), tagChoices.map((item) => /* @__PURE__ */ jsx("option", { children: item }, item))]
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn",
						onClick: startNew,
						children: "+ Add Contact"
					}),
					/* @__PURE__ */ jsx(FileDrop, {
						label: "Upload contacts",
						accept: ".csv,text/csv,.txt",
						compact: true,
						hint: "CSV or text file.",
						items: sheetFile ? [{ name: sheetFile }] : [],
						onRemove: () => {
							setSheetFile("");
							setSheet(null);
						},
						onFiles: (picked) => {
							const file = picked[0];
							if (!file) return;
							setSheetFile(file.name);
							file.text().then(async (csv) => {
								const result = await previewContactSheet({ data: {
									slug: desk.slug,
									code,
									csv
								} });
								if (!result.ok) {
									setSheetFile("");
									return ping(result.error);
								}
								const guess = (pattern) => result.titles.findIndex((title) => pattern.test(title.trim().toLowerCase()));
								setColumns({
									name: guess(/^name$|^full name$|^contact name$/) >= 0 ? guess(/^name$|^full name$|^contact name$/) : guess(/first name|^name/),
									last: guess(/last name/),
									email: guess(/^e-?mail$/),
									phone: guess(/^phone$|^mobile$|^telephone$/),
									tags: guess(/^tags?$/)
								});
								setSheet({
									csv,
									titles: result.titles,
									count: result.count
								});
							});
						}
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: `ua-btn ${allChecked ? "ua-btn-on" : ""}`,
						onClick: toggleAll,
						children: allChecked ? "All selected" : "Select all"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: `ua-btn ${chosenIds.length > 0 ? "ua-btn-on" : ""}`,
						onClick: () => {
							if (chosenIds.length === 0) return ping("Select at least one contact.");
							setPendingDelete("selected");
						},
						children: "Delete selected"
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn",
						onClick: () => {
							if (desk.contacts.length === 0) return ping("There are no contacts to delete.");
							setPendingDelete("all");
						},
						children: "Delete all"
					})
				]
			})]
		}),
		pendingDelete && /* @__PURE__ */ jsxs("div", {
			className: "mb-4 rounded-lg border p-4",
			style: {
				borderColor: "#b42318",
				background: "#fff8f6"
			},
			children: [/* @__PURE__ */ jsxs("p", {
				className: "text-base font-extrabold",
				style: { color: "#b42318" },
				children: [
					"Are you sure? ",
					pendingDelete === "all" ? `This will delete all ${desk.contacts.length} contacts.` : `This will delete ${chosenIds.length} selected contact${chosenIds.length === 1 ? "" : "s"}.`,
					" ",
					"We cannot retrieve this data once it is deleted."
				]
			}), /* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ jsx("button", {
					type: "button",
					className: "ua-btn",
					style: {
						background: "#b42318",
						color: "#fff"
					},
					onClick: () => {
						const mode = pendingDelete;
						setPendingDelete(null);
						(mode === "all" ? deleteAllContacts({ data: {
							slug: desk.slug,
							code
						} }) : deleteContacts({ data: {
							slug: desk.slug,
							code,
							ids: chosenIds
						} })).then(async (result) => {
							if (!result.ok) return ping(result.error);
							setChosenIds([]);
							ping(`Deleted ${result.count} contacts. This cannot be retrieved.`);
							await reload();
						});
					},
					children: "Yes, delete"
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "ua-btn-line",
					onClick: () => setPendingDelete(null),
					children: "No, keep them"
				})]
			})]
		}),
		/* @__PURE__ */ jsx("p", {
			className: "mb-4 text-sm",
			style: { color: "#5a6a7a" },
			children: searching ? "Searching all contacts…" : searchError ? searchError : query.trim() && rows.length === 0 ? "No contact matches that name or email." : query.trim() ? `${rows.length} contact${rows.length === 1 ? "" : "s"} match.` : "Tick the box beside a name, or use Select all. Delete selected removes only the ticked names. A button turns gold while it is selected or pressed."
		}),
		/* @__PURE__ */ jsx("div", {
			className: "ua-panel overflow-auto p-0",
			children: /* @__PURE__ */ jsxs("table", {
				className: "ua-table",
				children: [/* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
					/* @__PURE__ */ jsx("th", { children: "Name" }),
					/* @__PURE__ */ jsx("th", { children: "Email" }),
					/* @__PURE__ */ jsx("th", { children: "Phone" }),
					/* @__PURE__ */ jsx("th", { children: "DOB" }),
					/* @__PURE__ */ jsx("th", { children: "KYC" }),
					/* @__PURE__ */ jsx("th", { children: "Tags" }),
					/* @__PURE__ */ jsx("th", {})
				] }) }), /* @__PURE__ */ jsx("tbody", { children: rows.map((contact) => /* @__PURE__ */ jsxs("tr", { children: [
					/* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsxs("div", {
						className: "ua-name",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							"aria-label": `Select ${contact.fullName}`,
							checked: chosenIds.includes(contact.id),
							onChange: () => toggleOne(contact.id),
							style: { accentColor: chosenIds.includes(contact.id) ? "#c9a227" : "#0f4c81" }
						}), /* @__PURE__ */ jsx("span", { children: contact.fullName })]
					}) }),
					/* @__PURE__ */ jsx("td", { children: contact.email || "—" }),
					/* @__PURE__ */ jsx("td", { children: contact.phone || "—" }),
					/* @__PURE__ */ jsx("td", { children: contact.birthday || "—" }),
					/* @__PURE__ */ jsx("td", { children: contact.kycOn || "Due" }),
					/* @__PURE__ */ jsx("td", { children: (contact.tags || []).map((item) => /* @__PURE__ */ jsx("span", {
						className: "ua-tag",
						children: item
					}, item)) }),
					/* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn",
								style: { padding: "6px 12px" },
								onClick: () => startEdit(contact),
								children: "Edit"
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn",
								style: { padding: "6px 12px" },
								onClick: () => {
									if (!window.confirm(`Delete ${contact.fullName}?`)) return;
									deleteContact({ data: {
										slug: desk.slug,
										code,
										id: contact.id
									} }).then(async (result) => {
										if (!result.ok) return ping(result.error);
										setChosenIds((current) => current.filter((id) => id !== contact.id));
										ping("Contact deleted");
										await reload();
									});
								},
								children: "Delete"
							})
						]
					}) })
				] }, contact.id)) })]
			})
		}),
		sheet && /* @__PURE__ */ jsx("div", {
			className: "ua-modal",
			children: /* @__PURE__ */ jsxs("form", {
				className: "ua-panel max-h-[90vh] w-[520px] max-w-full overflow-auto p-7",
				onSubmit: (event) => {
					event.preventDefault();
					if (columns.name < 0) return ping("Match the Name column before uploading.");
					importContacts({ data: {
						slug: desk.slug,
						code,
						csv: sheet.csv,
						columns
					} }).then(async (result) => {
						if (!result.ok) return ping(result.error);
						setSheet(null);
						setSheetFile("");
						ping(result.skipped ? `Added ${result.added}. Skipped ${result.skipped} already on the list or incomplete.` : `Added ${result.added} contacts.`);
						await reload();
					});
				},
				children: [
					/* @__PURE__ */ jsx("h2", {
						className: "mb-2 text-xl font-semibold",
						children: "Match the columns"
					}),
					/* @__PURE__ */ jsxs("p", {
						className: "mb-4 text-sm",
						style: { color: "#5a6a7a" },
						children: [sheetFile ? `${sheetFile}. ` : "", sheet.count, " contacts found. Match each spreadsheet title to a desk column. A tag is added only if you or Superadmin already created it. File numbers are not tags."]
					}),
					[
						[
							"name",
							"Name",
							true
						],
						[
							"last",
							"Last name",
							false
						],
						[
							"email",
							"Email",
							false
						],
						[
							"phone",
							"Phone",
							false
						],
						[
							"tags",
							"Tags",
							false
						]
					].map(([key, label, required]) => /* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: [
							label,
							required ? "" : " (optional)",
							/* @__PURE__ */ jsxs("select", {
								className: "ua-field font-normal",
								value: columns[key],
								onChange: (event) => setColumns({
									...columns,
									[key]: Number(event.target.value)
								}),
								children: [/* @__PURE__ */ jsx("option", {
									value: -1,
									children: required ? "Choose a column" : "Do not use"
								}), sheet.titles.map((title, index) => /* @__PURE__ */ jsx("option", {
									value: index,
									children: title
								}, `${title}-${index}`))]
							})
						]
					}, key)),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-4 flex justify-end gap-2",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							onClick: () => {
								setSheet(null);
								setSheetFile("");
							},
							children: "Cancel"
						}), /* @__PURE__ */ jsx("button", {
							type: "submit",
							className: "ua-btn",
							children: "Upload matched columns"
						})]
					})
				]
			})
		}),
		open && /* @__PURE__ */ jsx("div", {
			className: "ua-modal",
			children: /* @__PURE__ */ jsxs("form", {
				onSubmit,
				className: "ua-panel max-h-[90vh] w-[520px] max-w-full overflow-auto p-7",
				children: [
					/* @__PURE__ */ jsx("h2", {
						className: "mb-4 text-xl font-semibold",
						children: editing ? "Edit contact" : "Add contact"
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: ["Name", /* @__PURE__ */ jsx("input", {
							required: true,
							value: name,
							onChange: (event) => setName(event.target.value),
							className: "ua-field font-normal"
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: ["Email", /* @__PURE__ */ jsx("input", {
							type: "email",
							value: email,
							onChange: (event) => setEmail(event.target.value),
							className: "ua-field font-normal"
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: ["Phone", /* @__PURE__ */ jsx("input", {
							value: phone,
							onChange: (event) => setPhone(event.target.value),
							className: "ua-field font-normal"
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: ["DOB", /* @__PURE__ */ jsx("input", {
							type: "date",
							value: birthday,
							onChange: (event) => setBirthday(event.target.value),
							className: "ua-field font-normal"
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: [
							"KYC date",
							/* @__PURE__ */ jsx("input", {
								type: "date",
								value: kycOn,
								onChange: (event) => setKycOn(event.target.value),
								className: "ua-field font-normal"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "font-normal",
								style: { color: "#5a6a7a" },
								children: "Leave blank until KYC is done. It is due again one year later."
							})
						]
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mb-2 text-sm font-semibold",
						children: "Products on file"
					}),
					/* @__PURE__ */ jsx("div", {
						className: "mb-3 flex flex-wrap gap-2",
						children: PRODUCT_OPTIONS.map((item) => {
							const on = products.includes(item.id);
							return /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-tag",
								style: on ? {
									background: "#0f4c81",
									color: "#fff"
								} : void 0,
								onClick: () => setProducts(on ? products.filter((id) => id !== item.id) : [...products, item.id]),
								children: item.label
							}, item.id);
						})
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: ["Product details", /* @__PURE__ */ jsx("textarea", {
							value: productNote,
							onChange: (event) => setProductNote(event.target.value),
							maxLength: 2e3,
							rows: 3,
							placeholder: "Policy numbers, amounts, or notes",
							className: "ua-field font-normal"
						})]
					}),
					editing && /* @__PURE__ */ jsxs("div", {
						className: "mb-4 rounded-lg border p-3",
						style: { borderColor: "#e1e8ef" },
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "mb-2 text-sm font-semibold",
								children: "Log"
							}),
							/* @__PURE__ */ jsxs("ul", {
								className: "mb-3 max-h-40 overflow-auto text-sm",
								children: [logs.length === 0 && /* @__PURE__ */ jsx("li", {
									style: { color: "#5a6a7a" },
									children: "No notes or messages yet."
								}), logs.map((item) => /* @__PURE__ */ jsxs("li", {
									className: "border-b py-1",
									style: { borderColor: "#eef2f6" },
									children: [/* @__PURE__ */ jsxs("span", {
										style: { color: "#5a6a7a" },
										children: [
											new Date(item.createdAt).toLocaleString(),
											" · ",
											item.kind
										]
									}), /* @__PURE__ */ jsx("div", { children: item.summary })]
								}, item.id))]
							}),
							/* @__PURE__ */ jsx("textarea", {
								value: logNote,
								onChange: (event) => setLogNote(event.target.value),
								rows: 2,
								maxLength: 500,
								placeholder: "Call, meeting, or note",
								className: "ua-field mb-2 font-normal"
							}),
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn",
								onClick: () => {
									addContactLog({ data: {
										slug: desk.slug,
										code,
										id: editing,
										note: logNote
									} }).then((result) => {
										if (!result.ok) return setError(result.error || "The note was not saved.");
										setLogs(result.logs || []);
										setLogNote("");
										setError("");
									});
								},
								children: "Add to log"
							})
						]
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mb-2 text-sm font-semibold",
						children: "Tags"
					}),
					/* @__PURE__ */ jsx("div", {
						className: "mb-3 flex flex-wrap gap-2",
						children: tagChoices.map((item) => {
							const on = picked.includes(item);
							return /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-tag",
								style: on ? {
									background: "#0f4c81",
									color: "#fff"
								} : void 0,
								onClick: () => setPicked(on ? picked.filter((tag) => tag !== item) : [...picked, item]),
								children: item
							}, item);
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mb-4 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ jsx("input", {
							value: extra,
							onChange: (event) => setExtra(event.target.value),
							placeholder: "Tag name",
							className: "ua-field"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn shrink-0",
							onClick: () => {
								const tagName = extra.trim();
								if (tagName.length < 2) return;
								addAdvisorTag({ data: {
									slug: desk.slug,
									code,
									name: tagName
								} }).then(async (result) => {
									if (!result.ok) {
										setError(result.error);
										return;
									}
									setPicked((current) => current.includes(result.name) ? current : [...current, result.name]);
									setExtra("");
									await reload();
								});
							},
							children: "Add new tag"
						})]
					}),
					error && /* @__PURE__ */ jsx("p", {
						className: "mb-3 text-sm text-[#c0392b]",
						children: error
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex justify-end gap-2",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							onClick: () => setOpen(false),
							children: "Cancel"
						}), /* @__PURE__ */ jsx("button", {
							type: "submit",
							className: "ua-btn",
							children: "Save"
						})]
					})
				]
			})
		})
	] });
}
function contactLines(desk, includeName) {
	const profile = readProfile(desk);
	const name = (profile.name || desk.advisorName).trim();
	const raw = [
		includeName ? name : "",
		profile.titleShow ? profile.title : "",
		profile.company,
		profile.phone,
		profile.email,
		profile.websiteShow ? profile.website : ""
	];
	const seen = /* @__PURE__ */ new Set();
	if (name) seen.add(name.toLowerCase());
	const lines = [];
	for (const item of raw) {
		const line = item.trim();
		const key = line.toLowerCase();
		if (!line || seen.has(key)) continue;
		seen.add(key);
		lines.push(line);
	}
	return {
		name,
		lines,
		photo: profile.photo,
		photoOnCard: profile.photoOnCard,
		flipCard: profile.flipCard,
		photoPosition: profile.photoPosition
	};
}
function AdvisorFooter({ desk }) {
	const contact = contactLines(desk, true);
	const showPhoto = Boolean(contact.photo && contact.photoOnCard);
	return /* @__PURE__ */ jsxs("div", {
		className: "flex items-center justify-center gap-4 border-t bg-white px-4 py-4 text-center text-sm",
		style: { borderColor: "#eee" },
		children: [showPhoto && /* @__PURE__ */ jsx("img", {
			src: contact.photo,
			alt: "",
			style: {
				display: "block",
				width: "auto",
				maxWidth: 140,
				maxHeight: 140,
				height: "auto",
				borderRadius: 8,
				transform: contact.flipCard ? "scaleX(-1)" : void 0
			}
		}), /* @__PURE__ */ jsxs("div", {
			className: showPhoto ? "text-left" : "text-center",
			children: [contact.name && /* @__PURE__ */ jsx("strong", {
				className: "block",
				children: contact.name
			}), contact.lines.map((line) => isWebsiteLine(line) ? /* @__PURE__ */ jsx("a", {
				href: websiteHref(line),
				target: "_blank",
				rel: "noreferrer",
				className: "mt-2 inline-block rounded-lg px-4 py-2 text-sm font-bold",
				style: {
					background: "#C9A227",
					color: "#1a1916",
					textDecoration: "none"
				},
				children: "Visit my website"
			}, "website") : /* @__PURE__ */ jsx("span", {
				className: "block",
				children: line
			}, line))]
		})]
	});
}
function CardsTab({ code, desk, reload, ping }) {
	const [title, setTitle] = useState(CARDS[0]?.title ?? "");
	const [message, setMessage] = useState(CARDS[0]?.message ?? "Dear [Contact Name],\n\n");
	const [image, setImage] = useState(CARDS[0]?.image ?? "");
	const [wash, setWash] = useState(WASH.birthday);
	const [selected, setSelected] = useState([]);
	const [tag, setTag] = useState("");
	const [upload, setUpload] = useState(false);
	const [sharedCards, setSharedCards] = useState(desk.sharedCards ?? []);
	const [customTitle, setCustomTitle] = useState("");
	const [customMessage, setCustomMessage] = useState("Dear [Contact Name],\n\n");
	const [customImage, setCustomImage] = useState("");
	const [busy, setBusy] = useState(false);
	const [stockCards, setStockCards] = useState(CARDS);
	const hidden = new Set(desk.hiddenCardIds);
	const stock = stockCards.filter((card) => !hidden.has(card.id));
	const people = tag ? desk.contacts.filter((contact) => contact.tags.includes(tag)) : desk.contacts;
	const chosen = desk.contacts.filter((contact) => selected.includes(contact.id));
	const previewContact = chosen[0];
	const previewText = personalize(message, previewContact?.fullName || "[Contact Name]");
	useEffect(() => {
		setSharedCards(desk.sharedCards ?? []);
	}, [desk.sharedCards]);
	useEffect(() => {
		listCatalogCards().then(setStockCards);
		listTemplates().then((rows) => setSharedCards(rows.filter((row) => row.kind === "card").map((row) => ({
			id: row.id,
			name: row.name,
			body: row.body || row.detail,
			image: row.hasImage ? `/api/platform-cards/${row.id}?v=2` : ""
		}))));
	}, []);
	function drop(kind, id, cardTitle) {
		if (!window.confirm("Remove this card from your gallery?")) return;
		setBusy(true);
		removeCard({ data: {
			slug: desk.slug,
			code,
			kind,
			id
		} }).then(async (result) => {
			setBusy(false);
			if (!result.ok) return ping(result.error);
			if (title === cardTitle) {
				setTitle("");
				setMessage("Dear [Contact Name],\n\n");
				setImage("");
			}
			ping("Card removed");
			await reload();
		});
	}
	async function keep() {
		const targets = desk.contacts.filter((contact) => selected.includes(contact.id));
		if (targets.length === 0) return ping("Choose at least one contact.");
		const missing = targets.filter((contact) => !contact.email.trim());
		if (missing.length > 0) return ping(`Add an email for ${missing.map((contact) => contact.fullName).join(", ")}.`);
		setBusy(true);
		const contact = contactLines(desk, true);
		const signature = [contact.name, ...contact.lines].filter(Boolean).join("\n");
		const result = await archiveMessages({ data: {
			slug: desk.slug,
			code,
			kind: "card",
			title,
			subject: "",
			body: message,
			contactIds: selected,
			image,
			signature
		} });
		setBusy(false);
		if (!result.ok) return ping(result.error);
		ping(`Sent from your email to ${result.count} recipient(s).`);
		setSelected([]);
		await reload();
	}
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("div", {
			className: "mb-4 flex flex-wrap items-center justify-between gap-3",
			children: [/* @__PURE__ */ jsx("h2", {
				className: "text-lg font-semibold",
				children: "E-Card Gallery"
			}), /* @__PURE__ */ jsx("button", {
				type: "button",
				className: "ua-btn",
				onClick: () => {
					setCustomMessage("Dear [Contact Name],\n\n");
					setCustomImage("");
					setUpload(true);
				},
				children: "+ Add a card"
			})]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel p-6",
			children: [/* @__PURE__ */ jsx("p", {
				className: "mb-5 text-sm",
				style: { color: "#5a6a7a" },
				children: "Select a card, edit the note, choose who should receive it, then press Send. Delete removes a card from this gallery only."
			}), /* @__PURE__ */ jsxs("div", {
				className: "grid gap-5 sm:grid-cols-2 xl:grid-cols-3",
				children: [
					stock.map((card) => /* @__PURE__ */ jsxs("div", {
						className: `ua-cardart ${title === card.title ? "selected" : ""}`,
						children: [/* @__PURE__ */ jsxs("button", {
							type: "button",
							className: "block w-full text-left",
							onClick: () => {
								setTitle(card.title);
								setMessage(card.message);
								setImage(card.image);
								setWash(WASH[card.id] ?? WASH.birthday);
							},
							children: [
								/* @__PURE__ */ jsx("div", {
									style: {
										height: 32,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										borderBottom: "1px solid #eee",
										color: "#0f4c81",
										fontWeight: 600,
										background: "#fff"
									},
									children: "Dear [Contact Name]"
								}),
								/* @__PURE__ */ jsx("img", {
									src: card.image,
									alt: card.title,
									style: {
										width: "100%",
										height: "auto",
										display: "block"
									}
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "p-3",
									style: {
										background: "#fff",
										color: "#1a2332"
									},
									children: [/* @__PURE__ */ jsx("h3", {
										className: "font-semibold",
										children: card.title
									}), /* @__PURE__ */ jsx("p", {
										className: "text-sm",
										style: { color: "#5a6a7a" },
										children: card.message.split("\n")[2] || "A note from the practice"
									})]
								}),
								/* @__PURE__ */ jsx(AdvisorFooter, { desk })
							]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line m-3",
							onClick: () => drop("builtin", card.id, card.title),
							children: "Delete"
						})]
					}, card.id)),
					sharedCards.filter((card) => !hidden.has(`shared-${card.id}`)).map((card) => /* @__PURE__ */ jsxs("div", {
						className: `ua-cardart ${title === card.name ? "selected" : ""}`,
						children: [/* @__PURE__ */ jsxs("button", {
							type: "button",
							className: "block w-full text-left",
							onClick: () => {
								const note = card.body.includes("[Contact Name]") ? card.body : `Dear [Contact Name],\n\n${card.body || card.name}`;
								setTitle(card.name);
								setMessage(note);
								setImage(card.image);
							},
							children: [
								/* @__PURE__ */ jsx("div", {
									style: {
										height: 32,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										borderBottom: "1px solid #eee",
										color: "#0f4c81",
										fontWeight: 600,
										background: "#fff"
									},
									children: "Dear [Contact Name]"
								}),
								card.image ? /* @__PURE__ */ jsx("img", {
									src: card.image,
									alt: card.name,
									style: {
										width: "100%",
										height: "auto",
										display: "block"
									}
								}) : /* @__PURE__ */ jsx("div", {
									className: "flex h-[120px] items-end p-4 text-white",
									style: { background: "linear-gradient(135deg,#0f4c81,#1a6bb5)" },
									children: /* @__PURE__ */ jsx("span", {
										className: "text-lg font-semibold",
										children: card.name
									})
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "p-3",
									style: {
										background: "#fff",
										color: "#1a2332"
									},
									children: [/* @__PURE__ */ jsx("h3", {
										className: "font-semibold",
										children: card.name
									}), /* @__PURE__ */ jsx("p", {
										className: "text-sm",
										style: { color: "#5a6a7a" },
										children: card.body.split("\n")[2] || "A note from the practice"
									})]
								}),
								/* @__PURE__ */ jsx(AdvisorFooter, { desk })
							]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line m-3",
							onClick: () => drop("builtin", `shared-${card.id}`, card.name),
							children: "Delete"
						})]
					}, `shared-${card.id}`)),
					desk.cards.map((card) => /* @__PURE__ */ jsxs("div", {
						className: `ua-cardart ${title === card.title ? "selected" : ""}`,
						children: [/* @__PURE__ */ jsxs("button", {
							type: "button",
							className: "block w-full text-left",
							onClick: () => {
								setTitle(card.title);
								setMessage(card.body.includes("[Contact Name]") ? card.body : `Dear [Contact Name],\n\n${card.body}`);
								setImage(card.image ?? "");
							},
							children: [
								/* @__PURE__ */ jsx("div", {
									style: {
										height: 32,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										borderBottom: "1px solid #eee",
										color: "#0f4c81",
										fontWeight: 600,
										background: "#fff"
									},
									children: "Dear [Contact Name]"
								}),
								card.image ? /* @__PURE__ */ jsx("img", {
									src: card.image,
									alt: card.title,
									style: {
										width: "100%",
										height: "auto",
										display: "block"
									}
								}) : /* @__PURE__ */ jsx("div", {
									className: "flex h-[120px] items-end p-4 text-white",
									style: { background: wash },
									children: /* @__PURE__ */ jsx("span", {
										className: "text-lg font-semibold",
										children: card.title
									})
								}),
								/* @__PURE__ */ jsxs("div", {
									className: "p-3",
									children: [/* @__PURE__ */ jsx("h3", {
										className: "font-semibold",
										children: card.title
									}), /* @__PURE__ */ jsx("p", {
										className: "text-sm",
										style: { color: "#c9a227" },
										children: "Saved by this practice"
									})]
								}),
								/* @__PURE__ */ jsx(AdvisorFooter, { desk })
							]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line m-3",
							onClick: () => drop("saved", String(card.id), card.title),
							children: "Delete"
						})]
					}, card.id))
				]
			})]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mt-6 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Send selected e-card"
				}),
				/* @__PURE__ */ jsxs("p", {
					className: "mt-1 text-sm",
					style: { color: "#5a6a7a" },
					children: [
						"Edit the note, then send. ",
						/* @__PURE__ */ jsx("code", { children: "[Contact Name]" }),
						" becomes each recipient’s own name. Mail goes from the address in Settings."
					]
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mt-4 grid gap-1 text-sm font-semibold",
					style: { color: "#5a6a7a" },
					children: ["Card message", /* @__PURE__ */ jsx("textarea", {
						value: message,
						onChange: (event) => setMessage(event.target.value),
						rows: 5,
						className: "ua-field font-normal"
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "ua-card-preview mt-4 overflow-hidden rounded-xl border",
					style: {
						borderColor: "#e1e8ef",
						background: "#fff"
					},
					children: [
						image ? /* @__PURE__ */ jsx("img", {
							src: image,
							alt: "",
							style: {
								width: "100%",
								height: "auto",
								display: "block"
							}
						}) : /* @__PURE__ */ jsx("div", {
							className: "p-4 text-white",
							style: {
								background: wash,
								minHeight: 72
							},
							children: /* @__PURE__ */ jsx("h3", {
								className: "text-base font-semibold",
								children: title
							})
						}),
						/* @__PURE__ */ jsx("p", {
							className: "px-3 py-3 text-sm whitespace-pre-wrap",
							style: { color: "#1a2332" },
							children: previewText
						}),
						/* @__PURE__ */ jsx(AdvisorFooter, { desk })
					]
				}),
				chosen.length > 0 && /* @__PURE__ */ jsx("ul", {
					className: "mt-3 text-sm",
					style: { color: "#5a6a7a" },
					children: chosen.map((contact) => /* @__PURE__ */ jsxs("li", { children: [
						contact.fullName,
						": ",
						personalize(message, contact.fullName).split("\n")[0]
					] }, contact.id))
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mt-4 grid gap-1 text-sm font-semibold",
					style: { color: "#5a6a7a" },
					children: ["Filter recipients by tag", /* @__PURE__ */ jsxs("select", {
						value: tag,
						onChange: (event) => setTag(event.target.value),
						className: "ua-field font-normal",
						children: [/* @__PURE__ */ jsx("option", {
							value: "",
							children: "All Contacts"
						}), desk.tags.map((item) => /* @__PURE__ */ jsx("option", { children: item }, item))]
					})]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-3 flex gap-2",
					children: [/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn-line",
						onClick: () => setSelected(people.map((contact) => contact.id)),
						children: "Select all"
					}), /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn-line",
						onClick: () => setSelected([]),
						children: "Deselect all"
					})]
				}),
				/* @__PURE__ */ jsxs("ul", {
					className: "mt-3 max-h-64 overflow-auto rounded-lg border",
					style: { borderColor: "#e1e8ef" },
					children: [people.length === 0 && /* @__PURE__ */ jsx("li", {
						className: "p-4 text-sm",
						style: { color: "#5a6a7a" },
						children: "No contacts match this tag."
					}), people.map((contact) => /* @__PURE__ */ jsxs("li", {
						className: "flex items-start gap-3 border-b px-3 py-2",
						style: { borderColor: "#e1e8ef" },
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							className: "mt-1 size-4",
							checked: selected.includes(contact.id),
							onChange: (event) => setSelected(event.target.checked ? [...selected, contact.id] : selected.filter((id) => id !== contact.id))
						}), /* @__PURE__ */ jsxs("span", { children: [
							/* @__PURE__ */ jsx("strong", { children: contact.fullName }),
							" ",
							/* @__PURE__ */ jsx("span", {
								className: "text-sm",
								style: { color: "#5a6a7a" },
								children: contact.email
							})
						] })]
					}, contact.id))]
				}),
				/* @__PURE__ */ jsx("button", {
					type: "button",
					disabled: busy,
					"aria-busy": busy,
					className: `ua-btn ua-send mt-4${busy ? " is-busy" : ""}`,
					style: { background: busy ? "#06355c" : "#0d7a4f" },
					onClick: () => void keep(),
					children: busy ? "Sending…" : "Send"
				})
			]
		}),
		upload && /* @__PURE__ */ jsx("div", {
			className: "ua-modal",
			children: /* @__PURE__ */ jsxs("form", {
				onSubmit: (event) => {
					event.preventDefault();
					setBusy(true);
					saveCard({ data: {
						slug: desk.slug,
						code,
						title: customTitle,
						message: customMessage,
						image: customImage
					} }).then(async (result) => {
						setBusy(false);
						if (!result.ok) return ping(result.error);
						setUpload(false);
						setCustomTitle("");
						setCustomMessage("Dear [Contact Name],\n\n");
						setCustomImage("");
						ping("E-card added to the gallery");
						await reload();
					});
				},
				className: "ua-panel w-[520px] max-w-full p-7",
				children: [
					/* @__PURE__ */ jsx("h2", {
						className: "mb-4 text-xl font-semibold",
						children: "Add a card"
					}),
					/* @__PURE__ */ jsx("input", {
						required: true,
						value: customTitle,
						onChange: (event) => setCustomTitle(event.target.value),
						placeholder: "Card name",
						className: "ua-field mb-3"
					}),
					/* @__PURE__ */ jsx("textarea", {
						required: true,
						value: customMessage,
						onChange: (event) => setCustomMessage(event.target.value),
						rows: 5,
						className: "ua-field"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-2 text-sm",
						style: { color: "#5a6a7a" },
						children: "[Contact Name] stays in the card. Each recipient sees their own name."
					}),
					/* @__PURE__ */ jsx(FileDrop, {
						label: customImage ? "Change picture" : "Upload picture",
						accept: "image/*",
						className: "mt-4",
						preview: customImage,
						previewName: "Card picture",
						shape: "wide",
						onClearPreview: () => setCustomImage(""),
						onFiles: (picked) => {
							const file = picked[0];
							if (!file) return;
							shrinkCardPhoto(file).then(setCustomImage).catch((error) => {
								setCustomImage("");
								ping(error instanceof Error ? error.message : "Could not read that picture.");
							});
						}
					}),
					customImage && /* @__PURE__ */ jsx("div", {
						className: "mt-2 flex gap-2",
						children: /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line",
							onClick: () => void turnPhoto(customImage).then(setCustomImage),
							children: "Flip"
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mt-4 flex justify-end gap-2",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line",
							onClick: () => {
								setCustomImage("");
								setUpload(false);
							},
							children: "Cancel"
						}), /* @__PURE__ */ jsx("button", {
							type: "submit",
							className: "ua-btn",
							children: "Save card"
						})]
					})
				]
			})
		})
	] });
}
function DripsTab({ code, desk, ping }) {
	const blank = () => ({
		title: "",
		body: ""
	});
	const [campaigns, setCampaigns] = useState([]);
	const [shared, setShared] = useState([]);
	const [editing, setEditing] = useState(null);
	const [name, setName] = useState("");
	const [boxes, setBoxes] = useState(1);
	const [steps, setSteps] = useState([blank()]);
	const [design, setDesign] = useState("");
	const [sendId, setSendId] = useState("");
	const [defaultId, setDefaultId] = useState("");
	const [tag, setTag] = useState("");
	const [everyDays, setEveryDays] = useState(7);
	const [picked, setPicked] = useState([]);
	const [busy, setBusy] = useState(false);
	function loadList(rows) {
		setCampaigns(rows);
	}
	useEffect(() => {
		listDrips({ data: {
			slug: desk.slug,
			code
		} }).then((result) => {
			if (!result.ok) return ping(result.error || "Campaigns could not be loaded.");
			loadList(result.campaigns || []);
			setShared(result.defaults || []);
			if (result.warning) ping(result.warning);
			else if (result.sent) ping(`Emailed the next article in ${result.sent} campaign${result.sent === 1 ? "" : "s"}.`);
		});
	}, [desk.slug, code]);
	function openCount(count) {
		const next = Math.min(12, Math.max(1, count));
		setBoxes(next);
		setSteps((current) => Array.from({ length: next }, (_, index) => current[index] ?? blank()));
	}
	function fill(source) {
		setEditing(source.id ?? null);
		setName(source.name);
		setBoxes(source.steps.length || 1);
		setSteps(source.steps.length ? source.steps : [blank()]);
		setDesign("");
	}
	async function keep() {
		const ready = steps.slice(0, boxes).map((step) => ({
			title: step.title.trim(),
			body: step.body.trim()
		}));
		if (name.trim().length < 2) return ping("Name the campaign.");
		setBusy(true);
		const result = await saveDrip({ data: {
			slug: desk.slug,
			code,
			id: editing,
			name: name.trim(),
			steps: ready,
			design
		} });
		setBusy(false);
		if (!result.ok) return ping(result.error);
		loadList(result.campaigns || []);
		setEditing(null);
		setName("");
		setBoxes(1);
		setSteps([blank()]);
		setDesign("");
		ping("Campaign saved. Choose it in Choose a campaign, then send it.");
	}
	function pickOwn(id) {
		setSendId(id);
		setDefaultId("");
		setPicked([]);
		setDesign("");
	}
	function pickDefault(id) {
		setDefaultId(id);
		setSendId("");
		setPicked([]);
		setDesign("");
	}
	async function sendChosen() {
		if (!design) return ping("Choose a campaign template before sending.");
		if (picked.length === 0) return ping("Choose the contacts who should receive it.");
		setBusy(true);
		let id = typeof sendId === "number" ? sendId : 0;
		if (!id && defaultId) {
			const item = shared.find((row) => row.id === defaultId);
			const packed = item ? readDripPack(item.body) : null;
			const stepsToSave = packed?.steps?.length ? packed.steps : [{
				title: "",
				body: ""
			}];
			if (!item) {
				setBusy(false);
				return ping("Pick a campaign.");
			}
			const saved = await saveDrip({ data: {
				slug: desk.slug,
				code,
				name: item.name,
				steps: stepsToSave,
				design
			} });
			if (!saved.ok) {
				setBusy(false);
				return ping(saved.error);
			}
			loadList(saved.campaigns || []);
			id = Number(saved.campaigns?.[0]?.id) || 0;
			setSendId(id);
			setDefaultId("");
		}
		if (!id) {
			setBusy(false);
			return ping("Choose a campaign.");
		}
		const result = await startDrip({ data: {
			slug: desk.slug,
			code,
			id,
			tag,
			everyDays,
			contactIds: picked,
			design
		} });
		setBusy(false);
		if (!result.ok) return ping(result.error);
		loadList(result.campaigns || []);
		if (result.warning) ping(result.warning);
		else ping(`The first article was emailed to ${picked.length} contact${picked.length === 1 ? "" : "s"}. The next articles go ${dripLabel(everyDays).toLowerCase()}.`);
	}
	const shown = desk.contacts.filter((contact) => !tag || contact.tags.includes(tag));
	const chosenName = sendId ? campaigns.find((item) => item.id === sendId)?.name || "" : shared.find((item) => item.id === defaultId)?.name || "";
	const readyToSend = Boolean(sendId || defaultId);
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: editing ? "Edit campaign" : "Create new campaign"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-1 mb-4 text-sm",
					style: { color: "#5a6a7a" },
					children: "Name the campaign and add the articles. The design is chosen after you pick the campaign."
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mb-3 grid gap-1 text-sm font-semibold",
					children: ["Campaign name", /* @__PURE__ */ jsx("input", {
						value: name,
						onChange: (event) => setName(event.target.value),
						className: "ua-field font-normal"
					})]
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mb-4 grid gap-1 text-sm font-semibold",
					children: ["How many articles", /* @__PURE__ */ jsx("select", {
						value: boxes,
						onChange: (event) => openCount(Number(event.target.value)),
						className: "ua-field font-normal",
						children: Array.from({ length: 12 }, (_, index) => /* @__PURE__ */ jsx("option", {
							value: index + 1,
							children: index + 1
						}, index + 1))
					})]
				}),
				steps.slice(0, boxes).map((step, index) => /* @__PURE__ */ jsxs("div", {
					className: "mb-4 rounded-lg border p-3",
					style: { borderColor: "#e1e8ef" },
					children: [/* @__PURE__ */ jsxs("label", {
						className: "grid gap-1 text-sm font-semibold",
						children: [
							"Article ",
							index + 1,
							" title",
							/* @__PURE__ */ jsx("input", {
								value: step.title,
								onChange: (event) => setSteps(steps.map((item, itemIndex) => itemIndex === index ? {
									...item,
									title: event.target.value
								} : item)),
								placeholder: "Title can be added later",
								className: "ua-field font-normal"
							})
						]
					}), /* @__PURE__ */ jsxs("label", {
						className: "mt-2 grid gap-1 text-sm font-semibold",
						children: [
							"Article ",
							index + 1,
							" body",
							/* @__PURE__ */ jsx("textarea", {
								value: step.body,
								rows: 4,
								onChange: (event) => setSteps(steps.map((item, itemIndex) => itemIndex === index ? {
									...item,
									body: event.target.value
								} : item)),
								placeholder: "Body can be added later",
								className: "ua-field font-normal"
							})
						]
					})]
				}, index)),
				/* @__PURE__ */ jsxs("div", {
					className: "flex flex-wrap gap-2",
					children: [/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn",
						disabled: busy,
						onClick: () => void keep(),
						children: "Save campaign"
					}), editing && /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn-line",
						onClick: () => {
							setEditing(null);
							setName("");
							setBoxes(1);
							setSteps([blank()]);
							setDesign("");
						},
						children: "Cancel edit"
					})]
				})
			]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mt-6 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Choose a campaign"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-1 mb-4 text-sm",
					style: { color: "#5a6a7a" },
					children: "Your saved campaigns and the default campaigns from Superadmin. Pick one, then send it below."
				}),
				/* @__PURE__ */ jsx("h3", {
					className: "mb-2 text-sm font-semibold",
					children: "Your campaigns"
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "grid gap-3",
					children: [campaigns.map((drip) => /* @__PURE__ */ jsxs("article", {
						className: "rounded-lg border p-4",
						style: {
							borderColor: sendId === drip.id ? "#0f4c81" : "#e1e8ef",
							background: sendId === drip.id ? "#f3f8fc" : "#fff"
						},
						children: [/* @__PURE__ */ jsxs("div", {
							className: "flex flex-wrap items-start justify-between gap-3",
							children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
								className: "font-semibold",
								children: drip.name
							}), /* @__PURE__ */ jsxs("p", {
								className: "mt-1 text-sm",
								style: { color: "#5a6a7a" },
								children: [
									drip.steps.length,
									" article",
									drip.steps.length === 1 ? "" : "s",
									" · ",
									ELETTER_DESIGNS.find((item) => item.id === drip.design)?.name || "No template",
									drip.active ? ` · Sending ${dripLabel(drip.everyDays).toLowerCase()}. Next is article ${Math.min(drip.nextIndex + 1, drip.steps.length)}${drip.nextAt ? ` on ${new Date(drip.nextAt).toLocaleString()}` : ""}` : " · Not sending"
								]
							})] }), /* @__PURE__ */ jsxs("div", {
								className: "flex gap-2",
								children: [
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "ua-btn",
										onClick: () => pickOwn(drip.id),
										children: "Choose"
									}),
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "ua-btn-line",
										onClick: () => fill(drip),
										children: "Edit"
									}),
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "ua-btn-line",
										onClick: () => {
											if (!window.confirm("Remove this campaign?")) return;
											deleteDrip({ data: {
												slug: desk.slug,
												code,
												id: drip.id
											} }).then((result) => {
												if (!result.ok) return ping(result.error || "Could not remove that campaign.");
												if (sendId === drip.id) setSendId("");
												loadList(result.campaigns || []);
												ping("Campaign removed.");
											});
										},
										children: "Remove"
									})
								]
							})]
						}), /* @__PURE__ */ jsx("ol", {
							className: "mt-3 list-decimal pl-5 text-sm",
							children: drip.steps.map((step, index) => /* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: step.title || `Article ${index + 1}` }), step.body ? ` — ${step.body.slice(0, 80)}` : ""] }, `${drip.id}-${index}`))
						})]
					}, drip.id)), campaigns.length === 0 && /* @__PURE__ */ jsx("p", {
						className: "text-sm",
						style: { color: "#5a6a7a" },
						children: "You have not created a campaign yet."
					})]
				}),
				/* @__PURE__ */ jsx("h3", {
					className: "mb-2 mt-5 text-sm font-semibold",
					children: "Default campaigns"
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "grid gap-3",
					children: [shared.map((item) => {
						const articles = readDripPack(item.body)?.steps ?? [];
						const selected = defaultId === item.id;
						return /* @__PURE__ */ jsxs("article", {
							className: "rounded-lg border p-4",
							style: {
								borderColor: selected ? "#0f4c81" : "#e1e8ef",
								background: selected ? "#f3f8fc" : "#fff"
							},
							children: [/* @__PURE__ */ jsxs("div", {
								className: "flex flex-wrap items-start justify-between gap-3",
								children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
									className: "font-semibold",
									children: item.name
								}), /* @__PURE__ */ jsxs("p", {
									className: "mt-1 text-sm",
									style: { color: "#5a6a7a" },
									children: [
										articles.length || 1,
										" article",
										(articles.length || 1) === 1 ? "" : "s",
										" · From Superadmin"
									]
								})] }), /* @__PURE__ */ jsx("button", {
									type: "button",
									className: "ua-btn",
									onClick: () => pickDefault(item.id),
									children: "Choose"
								})]
							}), articles.length > 0 && /* @__PURE__ */ jsx("ol", {
								className: "mt-3 list-decimal pl-5 text-sm",
								children: articles.map((step, index) => /* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("strong", { children: step.title || `Article ${index + 1}` }), step.body ? ` — ${step.body.slice(0, 80)}` : " — blank for now"] }, `${item.id}-${index}`))
							})]
						}, item.id);
					}), shared.length === 0 && /* @__PURE__ */ jsx("p", {
						className: "text-sm",
						style: { color: "#5a6a7a" },
						children: "No default campaigns yet."
					})]
				})
			]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mt-6 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Choose campaign template"
				}),
				!readyToSend && /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-sm",
					style: { color: "#5a6a7a" },
					children: "Choose a campaign first. Then pick the design it will be sent in."
				}),
				readyToSend && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("p", {
					className: "mt-1 mb-4 text-sm",
					style: { color: "#5a6a7a" },
					children: "Pick a design. The campaign has no template until you do. Sending opens after this."
				}), /* @__PURE__ */ jsx("div", {
					className: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
					children: ELETTER_DESIGNS.map((item) => /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: "ua-cardart p-4 text-left",
						style: { borderColor: design === item.id ? "#c9a227" : void 0 },
						onClick: () => setDesign(item.id),
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "mb-2 block h-2 rounded-full",
								style: { background: ELETTER_SWATCH[item.id] }
							}),
							/* @__PURE__ */ jsx("h3", {
								className: "font-semibold",
								children: item.name
							}),
							/* @__PURE__ */ jsx("p", {
								className: "text-sm",
								style: { color: "#5a6a7a" },
								children: item.detail
							})
						]
					}, item.id))
				}), design && /* @__PURE__ */ jsx("iframe", {
					title: "Campaign email preview",
					className: "mt-4 h-96 w-full rounded-lg border bg-white",
					style: { borderColor: "#e1e8ef" },
					srcDoc: dripMailPreview(desk, design)
				})] })
			]
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mt-6 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Send campaign"
				}),
				!readyToSend && /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-sm",
					style: { color: "#5a6a7a" },
					children: "Choose a campaign, then a template. The contact list opens after that."
				}),
				readyToSend && !design && /* @__PURE__ */ jsxs("p", {
					className: "mt-1 text-sm",
					style: { color: "#5a6a7a" },
					children: [
						"Choose a template for ",
						chosenName || "this campaign",
						". Then you can pick contacts and send."
					]
				}),
				readyToSend && Boolean(design) && /* @__PURE__ */ jsxs(Fragment, { children: [
					/* @__PURE__ */ jsxs("p", {
						className: "mt-1 mb-4 text-sm",
						style: { color: "#5a6a7a" },
						children: [
							"Sending ",
							/* @__PURE__ */ jsx("strong", { children: chosenName }),
							" in ",
							ELETTER_DESIGNS.find((item) => item.id === design)?.name,
							". Choose the contacts, then how often, then send."
						]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						children: ["Filter by tag", /* @__PURE__ */ jsxs("select", {
							value: tag,
							onChange: (event) => setTag(event.target.value),
							className: "ua-field font-normal",
							children: [/* @__PURE__ */ jsx("option", {
								value: "",
								children: "All contacts"
							}), desk.tags.map((item) => /* @__PURE__ */ jsx("option", { children: item }, item))]
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "mb-4",
						children: [/* @__PURE__ */ jsxs("div", {
							className: "mb-2 flex flex-wrap items-center justify-between gap-2",
							children: [/* @__PURE__ */ jsxs("p", {
								className: "text-sm font-semibold",
								children: [
									"Contacts (",
									picked.length,
									" chosen)"
								]
							}), /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn-line",
								onClick: () => setPicked((current) => [.../* @__PURE__ */ new Set([...current, ...shown.map((contact) => contact.id)])]),
								children: "Select shown"
							})]
						}), /* @__PURE__ */ jsxs("div", {
							className: "max-h-48 overflow-auto rounded-lg border p-2",
							style: { borderColor: "#e1e8ef" },
							children: [shown.length === 0 && /* @__PURE__ */ jsx("p", {
								className: "text-sm",
								style: { color: "#5a6a7a" },
								children: "No contacts in this list."
							}), shown.map((contact) => /* @__PURE__ */ jsxs("label", {
								className: "flex items-center gap-2 py-1 text-sm",
								children: [
									/* @__PURE__ */ jsx("input", {
										type: "checkbox",
										checked: picked.includes(contact.id),
										onChange: () => setPicked((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])
									}),
									/* @__PURE__ */ jsx("span", { children: contact.fullName }),
									!contact.email && /* @__PURE__ */ jsx("span", {
										style: { color: "#b42318" },
										children: "No email"
									})
								]
							}, contact.id))]
						})]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-4 grid gap-1 text-sm font-semibold",
						children: ["How often", /* @__PURE__ */ jsx("select", {
							value: everyDays,
							onChange: (event) => setEveryDays(Number(event.target.value)),
							className: "ua-field font-normal",
							children: DRIP_INTERVALS.map(([days, label]) => /* @__PURE__ */ jsx("option", {
								value: days,
								children: label
							}, days))
						})]
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: "ua-btn",
						disabled: busy,
						onClick: () => void sendChosen(),
						children: "Run the campaign"
					})
				] })
			]
		})
	] });
}
function PricingTab() {
	return /* @__PURE__ */ jsx("div", {
		className: "grid gap-5 lg:grid-cols-3",
		children: [
			[
				"Starter",
				"$49",
				"$100",
				[
					"Up to 500 contacts",
					"E-cards",
					"Newsletters",
					"Drip campaigns"
				]
			],
			[
				"Professional",
				"$249",
				"$500",
				[
					"Unlimited contacts",
					"AI assistant",
					"Your own cards and newsletters",
					"Coverage website"
				]
			],
			[
				"Team",
				"$299",
				"$1,000",
				[
					"Everything in Professional",
					"AI assistant for each advisor",
					"Shown as Team to the operator"
				]
			]
		].map(([name, price, setup, items]) => /* @__PURE__ */ jsxs("article", {
			className: "ua-panel p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: name
				}),
				/* @__PURE__ */ jsxs("p", {
					className: "my-2 text-3xl font-bold",
					style: { color: "#0f4c81" },
					children: [price, /* @__PURE__ */ jsx("span", {
						className: "text-base font-medium",
						children: "/mo"
					})]
				}),
				/* @__PURE__ */ jsxs("p", {
					className: "mb-3 text-xl font-bold",
					children: ["One-time setup fee ", setup]
				}),
				/* @__PURE__ */ jsx("ul", {
					className: "text-sm",
					children: items.map((item) => /* @__PURE__ */ jsxs("li", { children: ["✓ ", item] }, item))
				})
			]
		}, name))
	});
}
function dripMailPreview(desk, design) {
	const profile = readProfile(desk);
	return renderEletter({
		letter: {
			kind: "eletter",
			design,
			kicker: "A note",
			title: "Campaign preview",
			subject: "Campaign preview",
			body: "Each article in this campaign is sent in this design.",
			social: {
				linkedin: "",
				instagram: "",
				facebook: "",
				youtube: ""
			}
		},
		contact: {
			name: profile.name || desk.advisorName,
			title: profile.titleShow ? profile.title : "",
			phone: profile.phone || "",
			email: profile.email || "",
			place: profile.company || "",
			website: profile.website || desk.contactWebsite || ""
		},
		logoSrc: "",
		mode: "preview"
	});
}
function rememberWebsite(desk, own, url) {
	const profile = readProfile(desk);
	const website = own ? url : browserPublicUrl(`/a/${desk.slug}/site`);
	localStorage.setItem(profileKey(desk.slug), JSON.stringify({
		...profile,
		website,
		websiteShow: true
	}));
}
function SettingsTab({ code, desk, ping, reload }) {
	const [own, setOwn] = useState(false);
	const [siteUrl, setSiteUrl] = useState("");
	const [siteNote, setSiteNote] = useState("");
	const [fromName, setFromName] = useState("");
	const [fromEmail, setFromEmail] = useState("");
	const [host, setHost] = useState("");
	const [provider, setProvider] = useState("outlook");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [hasPassword, setHasPassword] = useState(false);
	const [savedFrom, setSavedFrom] = useState("");
	const [mailNote, setMailNote] = useState("");
	const [microsoftConnected, setMicrosoftConnected] = useState(false);
	const [oauthConfigured, setOauthConfigured] = useState(false);
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [showSecret, setShowSecret] = useState(false);
	const [operatorCode, setOperatorCode] = useState("");
	const [testTo, setTestTo] = useState("");
	const [redirectUri, setRedirectUri] = useState("/api/microsoft/callback");
	const [busy, setBusy] = useState("");
	useEffect(() => {
		setRedirectUri(browserPublicUrl("/api/microsoft/callback"));
		const mail = new URLSearchParams(window.location.search).get("mail");
		const detail = new URLSearchParams(window.location.search).get("detail") || "";
		if (mail === "connected") setMailNote("Microsoft email is connected. Cards send from that mailbox. A password is not stored.");
		if (mail === "error") setMailNote(detail || "Microsoft sign-in did not finish.");
	}, []);
	useEffect(() => {
		getPublicSite({ data: { slug: desk.slug } }).then((site) => {
			if (!site) return;
			setOwn(site.siteMode === "own");
			setSiteUrl(site.siteUrl);
		});
		getMailSettings({ data: {
			slug: desk.slug,
			code
		} }).then((result) => {
			if (!result.ok) return;
			setFromName(result.fromName);
			setFromEmail(result.fromEmail);
			setSavedFrom(result.fromEmail);
			setHost(result.host);
			setMicrosoftConnected(result.microsoftConnected);
			setOauthConfigured(result.oauthConfigured);
			setTestTo((current) => current || result.fromEmail);
			const savedHost = result.host.toLowerCase();
			const domain = result.fromEmail.split("@")[1]?.toLowerCase() ?? "";
			if (result.microsoftConnected) setProvider("outlook");
			else if (savedHost.includes("gmail") || domain === "gmail.com" || domain === "googlemail.com") setProvider("gmail");
			else if (savedHost) setProvider("other");
			else setProvider("outlook");
			setPassword(result.password);
			setHasPassword(result.hasPassword);
		});
	}, [desk.slug, code]);
	const outlookReady = provider === "outlook" && microsoftConnected;
	const smtpReady = provider !== "outlook" && hasPassword && Boolean(savedFrom);
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		/* @__PURE__ */ jsx(AdvisorTimeZone, { code, slug: desk.slug }),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mb-5 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Your website"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-2 mb-4 text-sm",
					style: { color: "#5a6a7a" },
					children: "The built-in page shows your name, title, and photo from Profile. Change the words, tabs, pictures, and links under Website."
				}),
				/* @__PURE__ */ jsxs("form", {
					onSubmit: (event) => {
						event.preventDefault();
						saveAdvisorWebsite({ data: {
							slug: desk.slug,
							code,
							mode: own ? "own" : "builtin",
							url: siteUrl
						} }).then((result) => {
							if (!result.ok) {
								setSiteNote(result.error);
								return;
							}
							rememberWebsite(desk, own, siteUrl.trim());
							if (typeof reload === "function") void reload();
							setSiteNote(own ? "Your own link is on. The coverage page is not published." : "Your coverage page is published.");
							ping("Website choice saved");
						});
					},
					children: [
						/* @__PURE__ */ jsxs("label", {
							className: "mb-4 flex items-center gap-2 text-sm font-semibold",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								checked: own,
								onChange: (event) => setOwn(event.target.checked)
							}), "Use my own website instead"]
						}),
						own ? /* @__PURE__ */ jsxs("label", {
							className: "mb-3 grid gap-1 text-sm font-semibold",
							style: { color: "#5a6a7a" },
							children: ["Your website link", /* @__PURE__ */ jsx("input", {
								value: siteUrl,
								onChange: (event) => setSiteUrl(event.target.value),
								placeholder: "https://yourfirm.com",
								className: "ua-field font-normal"
							})]
						}) : /* @__PURE__ */ jsxs("p", {
							className: "mb-3 text-sm",
							children: [
								"Published at",
								" ",
								/* @__PURE__ */ jsx("a", {
									href: browserPublicUrl(`/a/${desk.slug}/site`),
									className: "font-semibold",
									style: { color: "#0f4c81" },
									children: browserPublicUrl(`/a/${desk.slug}/site`)
								})
							]
						}),
						/* @__PURE__ */ jsx("button", {
							type: "submit",
							className: "ua-btn",
							children: "Save website"
						}),
						siteNote && /* @__PURE__ */ jsx("p", {
							className: "mt-3 text-sm",
							children: siteNote
						})
					]
				})
			]
		}),
		/* @__PURE__ */ jsx(ConnectionsDesk, {
			code,
			desk,
			home: "settings"
		}),
		/* @__PURE__ */ jsxs("section", {
			className: "ua-panel mb-5 p-6",
			children: [
				/* @__PURE__ */ jsx("h2", {
					className: "text-lg font-semibold",
					children: "Email you send from"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-2 mb-4 text-sm",
					style: { color: "#5a6a7a" },
					children: outlookReady ? `Cards are sent from ${savedFrom} through Microsoft. No mailbox password is stored.` : smtpReady ? `Cards are sent from ${savedFrom}.` : provider === "outlook" ? "Outlook is not connected yet. Microsoft sign-in is used instead of a mailbox password." : "No sending mailbox is ready yet."
				}),
				/* @__PURE__ */ jsx("div", {
					className: "mb-4 flex flex-wrap gap-2",
					children: [
						["gmail", "Gmail"],
						["outlook", "Outlook"],
						["other", "Other"]
					].map(([id, label]) => /* @__PURE__ */ jsx("button", {
						type: "button",
						className: provider === id ? "ua-btn" : "ua-btn-line",
						onClick: () => setProvider(id),
						children: label
					}, id))
				}),
				provider === "outlook" ? /* @__PURE__ */ jsxs("div", { children: [
					/* @__PURE__ */ jsx("p", {
						className: "mb-4 text-sm",
						style: { color: "#5a6a7a" },
						children: "Works for a personal Outlook.com, Hotmail, or Live address and for a work or school Microsoft 365 mailbox. Unique Advisor never asks for or stores that mailbox password."
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "mb-3 grid gap-1 text-sm font-semibold",
						style: { color: "#5a6a7a" },
						children: ["Your name on the email", /* @__PURE__ */ jsx("input", {
							value: fromName,
							onChange: (event) => setFromName(event.target.value),
							className: "ua-field font-normal"
						})]
					}),
					microsoftConnected && /* @__PURE__ */ jsxs("p", {
						className: "mb-3 text-sm font-semibold",
						children: ["Connected as ", savedFrom]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap gap-2",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							"aria-busy": busy === "connect",
							disabled: busy !== "",
							style: { background: busy === "connect" ? "#06355c" : void 0 },
							onClick: () => {
								setBusy("connect");
								setMailNote("");
								beginMicrosoftConnect({ data: {
									slug: desk.slug,
									code,
									redirectUri,
									displayName: fromName
								} }).then((result) => {
									if (!result.ok) {
										setMailNote(result.error);
										setBusy("");
										return;
									}
									window.location.assign(result.url);
								});
							},
							children: busy === "connect" ? "Opening Microsoft…" : microsoftConnected ? "Reconnect Microsoft Email" : "Connect Microsoft Email"
						}), microsoftConnected && /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line",
							disabled: busy !== "",
							onClick: () => {
								setBusy("disconnect");
								disconnectMicrosoft({ data: {
									slug: desk.slug,
									code
								} }).then((result) => {
									setBusy("");
									if (!result.ok) {
										setMailNote(result.error);
										return;
									}
									setMicrosoftConnected(false);
									setMailNote("Microsoft email is disconnected. Cards will not send until you connect again.");
									ping("Microsoft email disconnected");
								});
							},
							children: busy === "disconnect" ? "Disconnecting…" : "Disconnect"
						})]
					}),
					microsoftConnected && /* @__PURE__ */ jsxs("div", {
						className: "mt-4",
						children: [/* @__PURE__ */ jsxs("label", {
							className: "mb-3 grid gap-1 text-sm font-semibold",
							style: { color: "#5a6a7a" },
							children: ["Send a test to", /* @__PURE__ */ jsx("input", {
								value: testTo,
								onChange: (event) => setTestTo(event.target.value),
								placeholder: savedFrom || "you@yourfirm.ca",
								className: "ua-field font-normal"
							})]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn",
							"aria-busy": busy === "test",
							disabled: busy !== "",
							style: { background: busy === "test" ? "#06355c" : "#0d7a4f" },
							onClick: () => {
								setBusy("test");
								setMailNote("");
								sendTestEmail({ data: {
									slug: desk.slug,
									code,
									to: testTo
								} }).then((result) => {
									setBusy("");
									if (!result.ok) {
										setMailNote(result.error);
										return;
									}
									setMailNote(`Test email sent to ${result.to}. Check the inbox and the junk folder.`);
									ping("Test email sent");
								});
							},
							children: busy === "test" ? "Sending test…" : "Send test email"
						})]
					}),
					!oauthConfigured && /* @__PURE__ */ jsx("p", {
						className: "mt-4 text-sm font-semibold",
						children: "Save the Microsoft app below before Connect can open Microsoft."
					}),
					/* @__PURE__ */ jsxs("details", {
						className: "mt-3",
						children: [
							/* @__PURE__ */ jsx("summary", {
								className: "cursor-pointer text-sm font-semibold",
								children: "Register the app in Microsoft Entra"
							}),
							/* @__PURE__ */ jsxs("ol", {
								className: "mt-3 list-decimal space-y-2 pl-5 text-sm",
								style: { color: "#5a6a7a" },
								children: [
									/* @__PURE__ */ jsx("li", { children: "Open Entra admin center, App registrations, New registration." }),
									/* @__PURE__ */ jsx("li", { children: "Name it Unique Advisor." }),
									/* @__PURE__ */ jsx("li", { children: "Supported account types: Accounts in any organizational directory and personal Microsoft accounts." }),
									/* @__PURE__ */ jsx("li", { children: "Platform: Web. Redirect URI, copied exactly:" })
								]
							}),
							/* @__PURE__ */ jsx("p", {
								className: "my-2 break-all rounded-lg px-3 py-2 text-sm",
								style: {
									background: "#e8f4fd",
									color: "#0a3a66"
								},
								children: redirectUri
							}),
							/* @__PURE__ */ jsxs("ol", {
								className: "list-decimal space-y-2 pl-5 text-sm",
								start: 5,
								style: { color: "#5a6a7a" },
								children: [
									/* @__PURE__ */ jsx("li", { children: "API permissions, Microsoft Graph, Delegated: Mail.Send and User.Read. A work tenant may need an admin to grant Mail.Send. offline_access is requested at sign-in so later sends still work." }),
									/* @__PURE__ */ jsx("li", { children: "Certificates & secrets, New client secret. Copy the Value, not the Secret ID." }),
									/* @__PURE__ */ jsx("li", { children: "Overview, copy the Application (client) ID. Paste both below with the super admin password. They are stored for this app only, not as a mailbox password." })
								]
							}),
							/* @__PURE__ */ jsxs("form", {
								className: "mt-4",
								onSubmit: (event) => {
									event.preventDefault();
									setBusy("app");
									setMailNote("");
									saveMicrosoftApp({ data: {
										code: operatorCode,
										clientId,
										clientSecret
									} }).then((result) => {
										setBusy("");
										if (!result.ok) {
											setMailNote(result.error);
											return;
										}
										setOauthConfigured(true);
										setClientSecret("");
										setMailNote("Microsoft app saved. Use Connect Microsoft Email and sign in with the mailbox that should send the cards.");
										ping("Microsoft app saved");
									});
								},
								children: [
									/* @__PURE__ */ jsxs("label", {
										className: "mb-3 grid gap-1 text-sm font-semibold",
										style: { color: "#5a6a7a" },
										children: ["Application (client) ID", /* @__PURE__ */ jsx("input", {
											value: clientId,
											onChange: (event) => setClientId(event.target.value),
											className: "ua-field font-normal",
											autoComplete: "off"
										})]
									}),
									/* @__PURE__ */ jsxs("label", {
										className: "mb-3 grid gap-1 text-sm font-semibold",
										style: { color: "#5a6a7a" },
										children: ["Client secret value", /* @__PURE__ */ jsxs("span", {
											className: "flex gap-2",
											children: [/* @__PURE__ */ jsx("input", {
												type: showSecret ? "text" : "password",
												value: clientSecret,
												onChange: (event) => setClientSecret(event.target.value),
												className: "ua-field font-normal",
												autoComplete: "off"
											}), /* @__PURE__ */ jsx("button", {
												type: "button",
												className: "ua-btn-line shrink-0",
												onClick: () => setShowSecret((current) => !current),
												children: showSecret ? "Hide" : "Show"
											})]
										})]
									}),
									/* @__PURE__ */ jsxs("label", {
										className: "mb-3 grid gap-1 text-sm font-semibold",
										style: { color: "#5a6a7a" },
										children: ["Super admin password", /* @__PURE__ */ jsx("input", {
											type: "password",
											value: operatorCode,
											onChange: (event) => setOperatorCode(event.target.value),
											className: "ua-field font-normal",
											autoComplete: "off"
										})]
									}),
									/* @__PURE__ */ jsx("button", {
										type: "submit",
										className: "ua-btn",
										disabled: busy !== "",
										"aria-busy": busy === "app",
										style: { background: busy === "app" ? "#06355c" : void 0 },
										children: busy === "app" ? "Saving…" : oauthConfigured ? "Replace Microsoft app" : "Save Microsoft app"
									})
								]
							})
						]
					})
				] }) : /* @__PURE__ */ jsxs("form", {
					onSubmit: (event) => {
						event.preventDefault();
						setBusy("save");
						const server = provider === "gmail" ? "smtp.gmail.com" : host;
						saveMailSettings({ data: {
							slug: desk.slug,
							code,
							fromEmail,
							fromName,
							host: server,
							port: 587,
							password
						} }).then((result) => {
							setBusy("");
							if (!result.ok) {
								setMailNote(result.error);
								return;
							}
							const next = fromEmail.trim().toLowerCase();
							setHasPassword(true);
							setSavedFrom(next);
							setFromEmail(next);
							setMicrosoftConnected(false);
							setTestTo((current) => current || next);
							getMailSettings({ data: {
								slug: desk.slug,
								code
							} }).then((loaded) => {
								if (loaded.ok) setPassword(loaded.password);
							});
							setMailNote(result.warning ? `The address ${next} is saved, but mail cannot be sent yet. ${result.warning}` : `Saved. Cards will be sent from ${next}.`);
							ping("Sending email saved");
						});
					},
					children: [
						/* @__PURE__ */ jsxs("label", {
							className: "mb-3 grid gap-1 text-sm font-semibold",
							style: { color: "#5a6a7a" },
							children: ["Your name on the email", /* @__PURE__ */ jsx("input", {
								value: fromName,
								onChange: (event) => setFromName(event.target.value),
								className: "ua-field font-normal"
							})]
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "mb-3 grid gap-1 text-sm font-semibold",
							style: { color: "#5a6a7a" },
							children: ["Email address", /* @__PURE__ */ jsx("input", {
								type: "email",
								required: true,
								value: fromEmail,
								onChange: (event) => setFromEmail(event.target.value),
								placeholder: "you@gmail.com",
								className: "ua-field font-normal"
							})]
						}),
						provider === "other" && /* @__PURE__ */ jsxs("label", {
							className: "mb-3 grid gap-1 text-sm font-semibold",
							style: { color: "#5a6a7a" },
							children: ["Mail server", /* @__PURE__ */ jsx("input", {
								value: host,
								onChange: (event) => setHost(event.target.value),
								placeholder: "smtp.yourfirm.com",
								className: "ua-field font-normal"
							})]
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "mb-3 grid gap-1 text-sm font-semibold",
							style: { color: "#5a6a7a" },
							children: ["Mailbox password", /* @__PURE__ */ jsxs("span", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ jsx("input", {
									type: showPassword ? "text" : "password",
									value: password,
									onChange: (event) => setPassword(event.target.value),
									className: "ua-field font-normal",
									autoComplete: "off"
								}), /* @__PURE__ */ jsx("button", {
									type: "button",
									className: "ua-btn-line shrink-0",
									onClick: () => setShowPassword((current) => !current),
									children: showPassword ? "Hide" : "Show"
								})]
							})]
						}),
						/* @__PURE__ */ jsx("button", {
							type: "submit",
							className: "ua-btn",
							disabled: busy !== "",
							"aria-busy": busy === "save",
							style: { background: busy === "save" ? "#06355c" : void 0 },
							children: busy === "save" ? "Saving…" : "Save sending email"
						}),
						hasPassword && /* @__PURE__ */ jsxs("div", {
							className: "mt-4",
							children: [/* @__PURE__ */ jsxs("label", {
								className: "mb-3 grid gap-1 text-sm font-semibold",
								style: { color: "#5a6a7a" },
								children: ["Send a test to", /* @__PURE__ */ jsx("input", {
									value: testTo,
									onChange: (event) => setTestTo(event.target.value),
									className: "ua-field font-normal"
								})]
							}), /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "ua-btn",
								"aria-busy": busy === "test",
								disabled: busy !== "",
								style: { background: busy === "test" ? "#06355c" : "#0d7a4f" },
								onClick: () => {
									setBusy("test");
									setMailNote("");
									sendTestEmail({ data: {
										slug: desk.slug,
										code,
										to: testTo
									} }).then((result) => {
										setBusy("");
										if (!result.ok) {
											setMailNote(result.error);
											return;
										}
										setMailNote(`Test email sent to ${result.to}. Check the inbox and the junk folder.`);
										ping("Test email sent");
									});
								},
								children: busy === "test" ? "Sending test…" : "Send test email"
							})]
						})
					]
				}),
				mailNote && /* @__PURE__ */ jsx("p", {
					className: "mt-3 text-sm",
					children: mailNote
				})
			]
		})
	] });
}
function ProfileTab({ code, desk, ping }) {
	const [profile, setProfile] = useState(() => readProfile(desk));
	function set(key, value) {
		setProfile((current) => ({
			...current,
			[key]: value
		}));
	}
	function save(event) {
		event.preventDefault();
		storeProfile(profile, true);
	}
	async function storeProfile(next, tell) {
		localStorage.setItem(profileKey(desk.slug), JSON.stringify(next));
		const photo = next.photoOnWebsite && next.photo ? next.flipWebsite ? await turnPhoto(next.photo) : next.photo : "";
		const result = await saveAdvisorIdentity({ data: {
			slug: desk.slug,
			code,
			name: next.name,
			title: next.titleShow ? next.title : "",
			photo,
			phone: next.phoneShow ? next.phone : "",
			cardEmail: next.emailShow ? next.email : "",
			company: next.companyShow ? next.company : "",
			website: next.websiteShow ? next.website : "",
			social: JSON.stringify({
				linkedin: next.linkedin,
				linkedinShow: next.linkedinShow,
				instagram: next.instagram,
				instagramShow: next.instagramShow,
				facebook: next.facebook,
				facebookShow: next.facebookShow,
				photoOnNewsletter: next.photoOnNewsletter,
				photoOnEletter: next.photoOnEletter,
				flipWebsite: next.flipWebsite,
				flipNewsletter: next.flipNewsletter,
				flipCard: next.flipCard,
				flipEletter: next.flipEletter
			})
		} });
		if (!result.ok) return ping(result.error);
		if (tell) ping("Profile saved.");
		else if (!next.photoOnWebsite) ping("Profile picture removed from the website.");
	}
	return /* @__PURE__ */ jsxs("form", {
		onSubmit: save,
		className: "ua-panel max-w-2xl p-6",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-lg font-semibold",
				children: "Advisor profile"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 mb-5 text-sm",
				style: { color: "#5a6a7a" },
				children: "Choose where your picture appears. Each box is separate."
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 grid gap-1 text-sm font-semibold",
				children: ["Full name", /* @__PURE__ */ jsx("input", {
					value: profile.name,
					onChange: (event) => set("name", event.target.value),
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["Title", /* @__PURE__ */ jsx("input", {
					value: profile.title,
					onChange: (event) => set("title", event.target.value),
					placeholder: "Financial Advisor",
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.titleShow,
					onChange: (event) => set("titleShow", event.target.checked)
				}), " Show title on the website and e-cards"]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["Phone", /* @__PURE__ */ jsx("input", {
					value: profile.phone,
					onChange: (event) => set("phone", event.target.value),
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.phoneShow,
					onChange: (event) => set("phoneShow", event.target.checked)
				}), " Show phone on the website"]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["Email", /* @__PURE__ */ jsx("input", {
					value: profile.email,
					onChange: (event) => set("email", event.target.value),
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.emailShow,
					onChange: (event) => set("emailShow", event.target.checked)
				}), " Show email on the website"]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["Company name", /* @__PURE__ */ jsx("input", {
					value: profile.company,
					onChange: (event) => set("company", event.target.value),
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.companyShow,
					onChange: (event) => set("companyShow", event.target.checked)
				}), " Show company name on the website"]
			}),
			/* @__PURE__ */ jsx("h3", {
				className: "mb-2 mt-2 text-base font-semibold",
				children: "Social links"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mb-3 text-sm",
				style: { color: "#5a6a7a" },
				children: "Tick a box to place that link on your newsletters."
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["LinkedIn", /* @__PURE__ */ jsx("input", {
					value: profile.linkedin,
					onChange: (event) => set("linkedin", event.target.value),
					placeholder: "https://",
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.linkedinShow,
					onChange: (event) => set("linkedinShow", event.target.checked)
				}), " Show LinkedIn on newsletters"]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["Instagram", /* @__PURE__ */ jsx("input", {
					value: profile.instagram,
					onChange: (event) => set("instagram", event.target.value),
					placeholder: "https://",
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.instagramShow,
					onChange: (event) => set("instagramShow", event.target.checked)
				}), " Show Instagram on newsletters"]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-2 grid gap-1 text-sm font-semibold",
				children: ["Facebook", /* @__PURE__ */ jsx("input", {
					value: profile.facebook,
					onChange: (event) => set("facebook", event.target.value),
					placeholder: "https://",
					className: "ua-field font-normal"
				})]
			}),
			/* @__PURE__ */ jsxs("label", {
				className: "mb-4 flex items-center gap-2 text-sm",
				children: [/* @__PURE__ */ jsx("input", {
					type: "checkbox",
					checked: profile.facebookShow,
					onChange: (event) => set("facebookShow", event.target.checked)
				}), " Show Facebook on newsletters"]
			}),
			/* @__PURE__ */ jsx(FileDrop, {
				label: profile.photo ? "Change picture" : "Upload picture",
				accept: "image/*",
				className: "mb-4",
				preview: profile.photo,
				previewName: "Profile picture",
				shape: "photo",
				onClearPreview: () => set("photo", ""),
				onFiles: (picked) => {
					const file = picked[0];
					if (!file) return;
					readPhotoFile(file).then((photo) => set("photo", photo)).catch((reason) => {
						ping(reason instanceof Error ? reason.message : "Choose a JPG or PNG picture.");
					});
				}
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mb-4 grid gap-3",
				children: [
					[
						"flipWebsite",
						"photoOnWebsite",
						"Website",
						"Show profile picture on the website"
					],
					[
						"flipNewsletter",
						"photoOnNewsletter",
						"E-newsletters",
						"Show profile picture on e-newsletters"
					],
					[
						"flipCard",
						"photoOnCard",
						"E-cards",
						"Show profile picture on e-cards"
					],
					[
						"flipEletter",
						"photoOnEletter",
						"E-letters",
						"Show profile picture on e-letters"
					]
				].map(([flipKey, showKey, label, showLabel]) => /* @__PURE__ */ jsxs("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [
						profile.photo && /* @__PURE__ */ jsx("img", {
							src: profile.photo,
							alt: "",
							style: {
								display: "block",
								width: "auto",
								maxWidth: 72,
								maxHeight: 72,
								height: "auto",
								borderRadius: 8,
								transform: profile[flipKey] ? "scaleX(-1)" : void 0
							}
						}),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "ua-btn-line",
							disabled: !profile.photo,
							onClick: () => set(flipKey, !profile[flipKey]),
							children: profile[flipKey] ? `${label} flipped` : `Flip ${label}`
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "flex items-center gap-2 text-sm",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								checked: profile[showKey],
								onChange: (event) => {
									const next = {
										...profile,
										[showKey]: event.target.checked
									};
									setProfile(next);
									if (showKey === "photoOnWebsite") storeProfile(next, false);
								}
							}), showLabel]
						})
					]
				}, flipKey))
			}),
			/* @__PURE__ */ jsx("button", {
				type: "submit",
				className: "ua-btn",
				children: "Save profile"
			})
		]
	});
}
function profileKey(slug) {
	return `ua-profile:${slug}`;
}
function readPhotoFile(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const scale = Math.min(1, 640 / Math.max(img.width, img.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(img.width * scale));
			canvas.height = Math.max(1, Math.round(img.height * scale));
			const context = canvas.getContext("2d");
			URL.revokeObjectURL(url);
			if (!context) {
				reject(/* @__PURE__ */ new Error("Could not read that picture."));
				return;
			}
			context.drawImage(img, 0, 0, canvas.width, canvas.height);
			resolve(canvas.toDataURL("image/jpeg", .82));
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(/* @__PURE__ */ new Error("Choose a JPG or PNG picture."));
		};
		img.src = url;
	});
}
function readProfile(desk) {
	const base = {
		name: desk.advisorName,
		title: desk.contactTitle || "",
		titleShow: true,
		phone: desk.contactPhone || "",
		phoneShow: true,
		cell: desk.contactPhone || "",
		email: desk.contactEmail || "",
		emailShow: true,
		company: desk.contactCompany || desk.practiceName,
		companyShow: true,
		website: desk.contactWebsite || "",
		websiteShow: true,
		photo: desk.photo || "",
		photoOnWebsite: true,
		photoOnCard: true,
		photoOnNewsletter: Boolean(desk.photoOnNewsletter),
		photoOnEletter: desk.photoOnEletter !== false && Boolean(desk.photoOnNewsletter),
		flipWebsite: false,
		flipNewsletter: false,
		flipCard: false,
		flipEletter: false,
		photoPosition: 30,
		linkedin: desk.linkedin || "",
		linkedinShow: Boolean(desk.linkedinShow),
		instagram: desk.instagram || "",
		instagramShow: Boolean(desk.instagramShow),
		facebook: desk.facebook || "",
		facebookShow: Boolean(desk.facebookShow)
	};
	if (typeof window === "undefined") return base;
	try {
		const saved = JSON.parse(localStorage.getItem(profileKey(desk.slug)) || "null");
		if (!saved) return base;
		const next = {
			...base,
			...saved
		};
		if (saved.photoOnWebsite === void 0) next.photoOnWebsite = saved.photoEnabled !== false;
		if (saved.photoOnCard === void 0) next.photoOnCard = saved.photoEnabled !== false;
		if (saved.photoOnEletter === void 0) next.photoOnEletter = Boolean(saved.photoOnNewsletter ?? base.photoOnEletter);
		const currentSite = String(desk.contactWebsite || "").trim();
		if (currentSite) next.website = currentSite;
		else if (desk.siteMode === "own" && String(desk.siteUrl || "").trim()) next.website = String(desk.siteUrl).trim();
		return next;
	} catch {
		return base;
	}
}
