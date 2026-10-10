import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  arrayUnion,
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Flower2,
  Link,
  LogOut,
  MessageCircle,
  Moon,
  MoreVertical,
  Pencil,
  Reply,
  Search,
  Send,
  Ship,
  Trash2,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { auth, db } from "./firebase.js";
import "./App.css";
import "./themes.css";
import CyberCity from "./CyberCity.jsx";
import SakuraTree from "./SakuraTree.jsx";
import OceanScene from "./OceanScene.jsx";

const THEME_KEY = "chatter-theme";

const PETALS = Array.from({ length: 14 }, (_, i) => ({
  x: `${(i * 37 + 11) % 100}%`,
  size: `${10 + ((i * 7) % 9)}px`,
  dur: `${9 + ((i * 5) % 8)}s`,
  delay: `${-((i * 13) % 16)}s`,
  drift: `${i % 2 ? "" : "-"}${30 + ((i * 11) % 50)}px`,
}));

function SakuraPetals() {
  return (
    <div className="petals" aria-hidden="true">
      {PETALS.map((petal, i) => (
        <span
          key={i}
          className="petal"
          style={{
            "--x": petal.x,
            "--size": petal.size,
            "--dur": petal.dur,
            "--delay": petal.delay,
            "--drift": petal.drift,
          }}
        />
      ))}
    </div>
  );
}

const THEMES = [
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "sakura", label: "Sakura", Icon: Flower2 },
  { id: "cyberpunk", label: "Cyberpunk", Icon: Zap },
  { id: "onepiece", label: "One Piece", Icon: Ship },
];

function ThemePicker({ theme, onChange }) {
  const [open, setOpen] = useState(false);
  const current = THEMES.find((option) => option.id === theme) || THEMES[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="theme-picker">
      <button
        className="icon-btn theme-toggle"
        type="button"
        title="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <current.Icon size={18} />
        <span className="sr-only">Change theme</span>
      </button>
      {open && (
        <div className="theme-menu" role="menu" onClick={(event) => event.stopPropagation()}>
          {THEMES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === theme}
              className={id === theme ? "active" : undefined}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
            >
              <span className={`theme-swatch ${id}`}>
                <Icon size={14} />
              </span>
              {label}
              {id === theme && <Check size={14} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getChatId(a, b) {
  return [a, b].sort().join("_");
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

function formatTime(timestamp) {
  if (!timestamp?.toDate) return "";
  return timestamp.toDate().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function authErrorMessage(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "That email is already registered.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "permission-denied":
      return "Firestore blocked this action. In Firebase Console → Firestore → Rules, allow read/write on the chats collection.";
    case "failed-precondition":
      return "Firestore needs an index for this chat query. Click Create index, wait a minute, then reopen the chat.";
    default:
      return error?.message || "Something went wrong. Try again.";
  }
}

function getFirestoreIndexUrl(error) {
  const match = String(error?.message || "").match(
    /https:\/\/console\.firebase\.google\.com[^\s)]+/,
  );
  return match?.[0] || "";
}

function sortMessages(docs) {
  return sortMessageList(docs.map((d) => ({ id: d.id, ...d.data() })));
}

function sortMessageList(list) {
  return [...list].sort((a, b) => {
    const ta = a.timestamp?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.timestamp?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

const PAGE_SIZE = 40;

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"]+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:'")\]}]+$/;

function toHref(raw) {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function splitLinks(text) {
  const parts = [];
  let lastIndex = 0;
  for (const match of (text || "").matchAll(URL_PATTERN)) {
    let raw = match[0];
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] || "";
    raw = raw.slice(0, raw.length - trailing.length);
    const href = toHref(raw);
    if (!href) continue;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push({ raw, href });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < (text || "").length) parts.push(text.slice(lastIndex));
  return parts;
}

function findLinks(text) {
  return splitLinks(text).filter((part) => typeof part !== "string");
}

function LinkifiedText({ text }) {
  return splitLinks(text).map((part, i) =>
    typeof part === "string" ? (
      <Fragment key={i}>{part}</Fragment>
    ) : (
      <a
        key={i}
        className="msg-link"
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {part.raw}
      </a>
    ),
  );
}

function snippet(text, length = 80) {
  const value = (text || "").trim();
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

const ONLINE_STALE_MS = 90_000;

function isUserOnline(presence, now = Date.now()) {
  if (!presence?.online) return false;
  const lastSeenMs = presence.lastSeen?.toMillis?.() ?? 0;
  if (!lastSeenMs) return true;
  return now - lastSeenMs < ONLINE_STALE_MS;
}

function formatLastSeen(timestamp) {
  if (!timestamp?.toDate) return "last seen recently";
  const date = timestamp.toDate();
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThat) / 86400000);
  if (dayDiff === 0) return `last seen today at ${time}`;
  if (dayDiff === 1) return `last seen yesterday at ${time}`;
  return `last seen ${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}

function Avatar({ name, className = "" }) {
  return (
    <div className={`avatar ${className}`.trim()} aria-hidden="true">
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function PresenceAvatar({ name, online, className = "" }) {
  return (
    <div className="presence-avatar">
      <Avatar name={name} className={className} />
      {online ? <span className="online-dot" aria-label="online" /> : null}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((option) => option.id === saved) ? saved : "dark";
  });
  const [isSignup, setIsSignup] = useState(false);
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
    username: "",
  });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchStatus, setSearchStatus] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);

  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);

  const [selectedFriend, setSelectedFriend] = useState(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [historyIds, setHistoryIds] = useState(() => new Set());
  const [draft, setDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatErrorLink, setChatErrorLink] = useState("");
  const [localReadAt, setLocalReadAt] = useState({});
  const [unreadDivider, setUnreadDivider] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [menuMessageId, setMenuMessageId] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);
  const [presenceByUid, setPresenceByUid] = useState({});
  const [nowTick, setNowTick] = useState(Date.now());
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const messagesListRef = useRef(null);
  const unreadDividerRef = useRef(null);
  const alignedForFriend = useRef(null);
  const typingTimeoutRef = useRef(null);
  const amTypingRef = useRef(false);
  const composerInputRef = useRef(null);
  const oldestSnapRef = useRef(null);
  const pagedOlderRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const scrollRestoreRef = useRef(null);
  const friends = profile?.friends || [];
  const friendIdsKey = friends.map((friend) => friend.uid).sort().join(",");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const themeLayer =
    theme === "sakura" ? (
      <SakuraPetals />
    ) : theme === "cyberpunk" ? (
      <div className="scanlines" aria-hidden="true" />
    ) : null;

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setProfile(null);
        setSelectedFriend(null);
        setMobileShowChat(false);
        setMessages([]);
        setIncomingRequests([]);
        setOutgoingRequests([]);
        setSearchResult(null);
        setSearchStatus("");
        setLocalReadAt({});
        setUnreadDivider(null);
        setReplyingTo(null);
        setEditingMessage(null);
        setMenuMessageId(null);
        setPresenceByUid({});
        setChatError("");
        setChatErrorLink("");
        document.title = "Chatter";
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    const unsubProfile = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : null);
    });

    const incomingQuery = query(
      collection(db, "friendRequests"),
      where("toUid", "==", user.uid),
      where("status", "==", "pending"),
    );
    const outgoingQuery = query(
      collection(db, "friendRequests"),
      where("fromUid", "==", user.uid),
      where("status", "==", "pending"),
    );

    const unsubIncoming = onSnapshot(incomingQuery, (snap) => {
      setIncomingRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubOutgoing = onSnapshot(outgoingQuery, (snap) => {
      setOutgoingRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubProfile();
      unsubIncoming();
      unsubOutgoing();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !selectedFriend) {
      setMessages([]);
      setHasMoreOlder(false);
      oldestSnapRef.current = null;
      pagedOlderRef.current = false;
      return undefined;
    }

    const chatId = getChatId(user.uid, selectedFriend.uid);
    oldestSnapRef.current = null;
    pagedOlderRef.current = false;
    setHasMoreOlder(true);
    setMessages([]);
    setHistoryIds(new Set());
    let firstSnapshot = true;

    const messagesQuery = query(
      collection(db, "chats"),
      where("chatId", "==", chatId),
      orderBy("timestamp", "desc"),
      limit(PAGE_SIZE),
    );

    const unsubMessages = onSnapshot(
      messagesQuery,
      (snap) => {
        const live = sortMessages(snap.docs);
        if (firstSnapshot) {
          firstSnapshot = false;
          setHistoryIds(new Set(live.map((message) => message.id)));
        }
        if (!pagedOlderRef.current && snap.docs.length) {
          oldestSnapRef.current = snap.docs[snap.docs.length - 1];
          setHasMoreOlder(snap.docs.length === PAGE_SIZE);
        }
        setMessages((prev) => {
          if (!pagedOlderRef.current) return live;
          const liveIds = new Set(live.map((message) => message.id));
          const older = prev.filter((message) => !liveIds.has(message.id));
          return sortMessageList([...older, ...live]);
        });
        setChatError("");
        setChatErrorLink("");
      },
      (error) => {
        setChatError(authErrorMessage(error));
        setChatErrorLink(getFirestoreIndexUrl(error));
      },
    );

    return () => unsubMessages();
  }, [user, selectedFriend]);

  useEffect(() => {
    if (!user) return undefined;

    const writePresence = (online) => {
      updateDoc(doc(db, "users", user.uid), {
        online,
        lastSeen: serverTimestamp(),
        ...(online ? {} : { typingTo: null }),
      }).catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") writePresence(true);
      else writePresence(false);
    };

    const goOffline = () => writePresence(false);

    writePresence(true);
    const heartbeat = window.setInterval(() => writePresence(true), 30000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", goOffline);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", goOffline);
      writePresence(false);
    };
  }, [user]);

  useEffect(() => {
    const tick = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!user || !friendIdsKey) {
      setPresenceByUid({});
      return undefined;
    }

    const ids = friendIdsKey.split(",");
    const unsubs = ids.map((uid) =>
      onSnapshot(doc(db, "users", uid), (snap) => {
        setPresenceByUid((prev) => ({ ...prev, [uid]: snap.data() || null }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [user, friendIdsKey]);

  useEffect(() => {
    if (!user || !selectedFriend) return undefined;
    return () => {
      clearTimeout(typingTimeoutRef.current);
      if (amTypingRef.current) {
        amTypingRef.current = false;
        updateDoc(doc(db, "users", user.uid), { typingTo: null }).catch(() => {});
      }
    };
  }, [user, selectedFriend]);

  useEffect(() => {
    if (!menuMessageId) return undefined;
    const close = () => setMenuMessageId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuMessageId]);

  useEffect(() => {
    alignedForFriend.current = null;
  }, [selectedFriend]);

  const friendPresence = selectedFriend ? presenceByUid[selectedFriend.uid] : null;
  const friendTyping = friendPresence?.typingTo === user?.uid;
  const friendOnline = isUserOnline(friendPresence, nowTick);
  const friendStatus = friendTyping
    ? "typing…"
    : friendOnline
      ? "online"
      : formatLastSeen(friendPresence?.lastSeen);

  useLayoutEffect(() => {
    const list = messagesListRef.current;
    if (!list || messages.length === 0) return undefined;

    if (scrollRestoreRef.current) {
      const { height, top } = scrollRestoreRef.current;
      list.scrollTop = top + (list.scrollHeight - height);
      scrollRestoreRef.current = null;
      return undefined;
    }

    const friendId = selectedFriend?.uid;
    const pinToUnreadBanner =
      unreadDividerRef.current &&
      unreadDivider?.friendUid === friendId &&
      alignedForFriend.current !== friendId;

    const scrollToLatest = () => {
      if (pinToUnreadBanner && unreadDividerRef.current) {
        list.scrollTop = Math.max(0, unreadDividerRef.current.offsetTop - 8);
        alignedForFriend.current = friendId;
        return;
      }
      list.scrollTop = list.scrollHeight;
      alignedForFriend.current = friendId;
    };

    scrollToLatest();
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [messages, unreadDivider, selectedFriend, friendTyping]);

  const latestIncomingId = messages
    .filter((message) => message.senderId === selectedFriend?.uid)
    .at(-1)?.id;

  useEffect(() => {
    if (!user || !selectedFriend) return undefined;
    updateDoc(doc(db, "users", user.uid), {
      [`lastReadAt.${selectedFriend.uid}`]: serverTimestamp(),
      [`unreadCounts.${selectedFriend.uid}`]: 0,
    }).catch(() => {});
  }, [user, selectedFriend, latestIncomingId]);

  const unreadByFriend = useMemo(() => {
    const counts = {};
    for (const friend of friends) {
      if (selectedFriend?.uid === friend.uid) {
        counts[friend.uid] = 0;
        continue;
      }
      counts[friend.uid] = profile?.unreadCounts?.[friend.uid] || 0;
    }
    return counts;
  }, [friends, profile, selectedFriend]);

  const totalUnread = Object.values(unreadByFriend).reduce((sum, n) => sum + n, 0);

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Chatter` : "Chatter";
  }, [totalUnread]);

  const selectedFriendLive = useMemo(() => {
    if (!selectedFriend) return null;
    return friends.find((friend) => friend.uid === selectedFriend.uid) || selectedFriend;
  }, [friends, selectedFriend]);

  function updateAuthField(field, value) {
    setAuthForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");
    setAuthBusy(true);

    try {
      if (isSignup) {
        const username = normalizeUsername(authForm.username);
        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
          throw new Error("Username must be 3–20 letters, numbers, or underscores.");
        }

        const taken = await getDocs(
          query(collection(db, "users"), where("username", "==", username)),
        );
        if (!taken.empty) {
          throw new Error("That username is already taken.");
        }

        const cred = await createUserWithEmailAndPassword(
          auth,
          authForm.email.trim(),
          authForm.password,
        );
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          username,
          email: authForm.email.trim(),
          friends: [],
          lastReadAt: {},
          unreadCounts: {},
          online: true,
          lastSeen: serverTimestamp(),
          typingTo: null,
        });
      } else {
        await signInWithEmailAndPassword(
          auth,
          authForm.email.trim(),
          authForm.password,
        );
      }
    } catch (error) {
      setAuthError(authErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    clearTimeout(typingTimeoutRef.current);
    if (user) {
      await updateDoc(doc(db, "users", user.uid), {
        typingTo: null,
        online: false,
        lastSeen: serverTimestamp(),
      }).catch(() => {});
    }
    amTypingRef.current = false;
    await signOut(auth);
  }

  async function setTyping(active) {
    if (!user || !selectedFriend) return;
    if (amTypingRef.current === active) return;
    amTypingRef.current = active;
    await updateDoc(doc(db, "users", user.uid), {
      typingTo: active ? selectedFriend.uid : null,
    }).catch(() => {});
  }

  function handleDraftChange(value) {
    setDraft(value);
    if (editingMessage) return;
    if (value.trim()) {
      setTyping(true);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTyping(false), 2000);
    } else {
      clearTimeout(typingTimeoutRef.current);
      setTyping(false);
    }
  }

  function clearComposerExtras() {
    setReplyingTo(null);
    setEditingMessage(null);
    setMenuMessageId(null);
  }

  function startReply(message) {
    setEditingMessage(null);
    setReplyingTo(message);
    setMenuMessageId(null);
    composerInputRef.current?.focus();
  }

  function startEdit(message) {
    if (message.senderId !== user?.uid || message.deleted) return;
    clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    setReplyingTo(null);
    setEditingMessage(message);
    setDraft(message.text || "");
    setMenuMessageId(null);
    composerInputRef.current?.focus();
  }

  async function deleteMessage(message) {
    if (!user || message.senderId !== user.uid) return;
    setMenuMessageId(null);
    try {
      await updateDoc(doc(db, "chats", message.id), {
        deleted: true,
        text: "",
      });
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setDraft("");
      }
      if (replyingTo?.id === message.id) {
        setReplyingTo({ ...message, deleted: true, text: "" });
      }
    } catch (error) {
      setChatError(authErrorMessage(error));
    }
  }

  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(""), 1600);
  }

  async function copyText(text, label) {
    setMenuMessageId(null);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied`);
    } catch {
      showToast("Couldn't copy — try selecting the text instead");
    }
  }

  function openLink(href) {
    setMenuMessageId(null);
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function jumpToMessage(id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("highlight");
    window.setTimeout(() => el.classList.remove("highlight"), 1400);
  }

  async function handleSearch(event) {
    event.preventDefault();
    if (!user) return;

    const username = normalizeUsername(searchTerm);
    setSearchResult(null);
    setSearchStatus("");

    if (!username) {
      setSearchStatus("Enter a username to search.");
      return;
    }

    setSearchBusy(true);
    try {
      const matches = await getDocs(
        query(collection(db, "users"), where("username", "==", username)),
      );
      if (matches.empty) {
        setSearchStatus("No user found with that username.");
        return;
      }

      const found = matches.docs[0].data();
      if (found.uid === user.uid) {
        setSearchStatus("That's you.");
        return;
      }

      setSearchResult(found);
    } catch (error) {
      setSearchStatus(authErrorMessage(error));
    } finally {
      setSearchBusy(false);
    }
  }

  function relationFor(targetUid) {
    if (friends.some((friend) => friend.uid === targetUid)) return "friends";
    if (outgoingRequests.some((req) => req.toUid === targetUid)) return "outgoing";
    if (incomingRequests.some((req) => req.fromUid === targetUid)) return "incoming";
    return "none";
  }

  async function sendFriendRequest(target) {
    if (!user || !profile) return;

    const existingOutgoing = await getDocs(
      query(
        collection(db, "friendRequests"),
        where("fromUid", "==", user.uid),
        where("toUid", "==", target.uid),
      ),
    );
    const existingIncoming = await getDocs(
      query(
        collection(db, "friendRequests"),
        where("fromUid", "==", target.uid),
        where("toUid", "==", user.uid),
      ),
    );
    const alreadyLinked = [...existingOutgoing.docs, ...existingIncoming.docs].some(
      (d) => d.data().status === "pending" || d.data().status === "accepted",
    );
    if (alreadyLinked) return;

    await addDoc(collection(db, "friendRequests"), {
      fromUid: user.uid,
      fromUsername: profile.username,
      toUid: target.uid,
      toUsername: target.username,
      status: "pending",
      createdAt: serverTimestamp(),
    });
  }

  async function acceptRequest(request) {
    if (!user || !profile) return;

    const batch = writeBatch(db);
    batch.update(doc(db, "friendRequests", request.id), { status: "accepted" });
    batch.update(doc(db, "users", user.uid), {
      friends: arrayUnion({ uid: request.fromUid, username: request.fromUsername }),
    });
    batch.update(doc(db, "users", request.fromUid), {
      friends: arrayUnion({ uid: user.uid, username: profile.username }),
    });
    await batch.commit();
  }

  async function rejectRequest(request) {
    await updateDoc(doc(db, "friendRequests", request.id), { status: "rejected" });
  }

  function openChat(friend) {
    const unread = profile?.unreadCounts?.[friend.uid] || 0;
    const savedRead = profile?.lastReadAt?.[friend.uid]?.toMillis?.() ?? 0;
    const lastReadMs = Math.max(savedRead, localReadAt[friend.uid] ?? 0);

    setUnreadDivider(
      unread > 0
        ? { friendUid: friend.uid, afterMs: lastReadMs, count: unread }
        : null,
    );
    setSelectedFriend(friend);
    setMobileShowChat(true);
    setDraft("");
    clearComposerExtras();
    setLocalReadAt((prev) => ({ ...prev, [friend.uid]: Date.now() }));
  }

  async function loadOlderMessages() {
    if (!user || !selectedFriend || loadingOlderRef.current || !hasMoreOlder) return;
    if (!oldestSnapRef.current) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const chatId = getChatId(user.uid, selectedFriend.uid);
      const page = await getDocs(
        query(
          collection(db, "chats"),
          where("chatId", "==", chatId),
          orderBy("timestamp", "desc"),
          startAfter(oldestSnapRef.current),
          limit(PAGE_SIZE),
        ),
      );
      const older = sortMessages(page.docs);
      if (page.docs.length > 0) {
        oldestSnapRef.current = page.docs[page.docs.length - 1];
        pagedOlderRef.current = true;
        const list = messagesListRef.current;
        if (list) {
          scrollRestoreRef.current = {
            height: list.scrollHeight,
            top: list.scrollTop,
          };
        }
        setHistoryIds((prev) => {
          const next = new Set(prev);
          older.forEach((message) => next.add(message.id));
          return next;
        });
        setMessages((prev) => {
          const ids = new Set(prev.map((message) => message.id));
          return sortMessageList([
            ...older.filter((message) => !ids.has(message.id)),
            ...prev,
          ]);
        });
      }
      setHasMoreOlder(page.docs.length === PAGE_SIZE);
    } catch (error) {
      setChatError(authErrorMessage(error));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  function onMessagesScroll(event) {
    if (event.currentTarget.scrollTop < 80) {
      loadOlderMessages();
    }
  }

  function closeChat() {
    setMobileShowChat(false);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!user || !selectedFriend) return;

    const text = draft.trim();
    if (!text) return;

    const wasEditing = editingMessage;
    const wasReply = replyingTo;
    setDraft("");
    setReplyingTo(null);
    setEditingMessage(null);
    setChatError("");
    clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());

    try {
      if (wasEditing) {
        await updateDoc(doc(db, "chats", wasEditing.id), {
          text,
          edited: true,
          editedAt: serverTimestamp(),
        });
        return;
      }

      const payload = {
        senderId: user.uid,
        receiverId: selectedFriend.uid,
        text,
        timestamp: serverTimestamp(),
        chatId: getChatId(user.uid, selectedFriend.uid),
      };
      if (wasReply) {
        payload.replyTo = {
          id: wasReply.id,
          text: wasReply.deleted ? "" : snippet(wasReply.text, 140),
          senderId: wasReply.senderId,
          deleted: !!wasReply.deleted,
        };
      }
      const messageRef = doc(collection(db, "chats"));
      const batch = writeBatch(db);
      batch.set(messageRef, payload);
      batch.update(doc(db, "users", selectedFriend.uid), {
        [`unreadCounts.${user.uid}`]: increment(1),
      });
      await batch.commit();
    } catch (error) {
      setDraft(text);
      setReplyingTo(wasReply);
      setEditingMessage(wasEditing);
      setChatError(authErrorMessage(error));
    }
  }

  if (!authReady) {
    return (
      <div className="app-root">
        <div className="loading-screen">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-root">
        {themeLayer}
        <div className="auth-screen">
          <div className="auth-card">
            <ThemePicker theme={theme} onChange={setTheme} />
            <div className="auth-brand">
              <div className="brand-icon">
                <MessageCircle size={22} />
              </div>
              <h1>Chatter</h1>
            </div>
            <p>
              {isSignup
                ? "Create an account to start messaging friends."
                : "Sign in to continue your conversations."}
            </p>
            {authError && <p className="error-banner">{authError}</p>}
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {isSignup && (
                <label>
                  Username
                  <input
                    value={authForm.username}
                    onChange={(e) => updateAuthField("username", e.target.value)}
                    autoComplete="username"
                    placeholder="yourname"
                    required
                  />
                </label>
              )}
              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(e) => updateAuthField("email", e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(e) => updateAuthField("password", e.target.value)}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </label>
              <button className="primary-btn" type="submit" disabled={authBusy}>
                {authBusy ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
              </button>
            </form>
            <p className="auth-switch">
              {isSignup ? "Already have an account?" : "Need an account?"}{" "}
              <button
                className="text-btn"
                type="button"
                onClick={() => {
                  setIsSignup((prev) => !prev);
                  setAuthError("");
                }}
              >
                {isSignup ? "Log in" : "Sign up"}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const relation = searchResult ? relationFor(searchResult.uid) : "none";
  const unreadStartIndex =
    unreadDivider?.friendUid === selectedFriend?.uid
      ? messages.findIndex((message) => {
          if (message.senderId === user.uid) return false;
          const sentAt = message.timestamp?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
          return sentAt > unreadDivider.afterMs;
        })
      : -1;

  return (
    <div className={`app-root app-shell${mobileShowChat ? " chat-open" : ""}`}>
      {themeLayer}
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="user-chip">
            <Avatar name={profile?.username} className="green" />
            <div>
              <strong>{profile?.username || "…"}</strong>
              <span>{profile?.email || user.email}</span>
            </div>
          </div>
          <div className="header-actions">
            <ThemePicker theme={theme} onChange={setTheme} />
            <button className="icon-btn" type="button" onClick={handleLogout} title="Log out">
              <LogOut size={18} />
              <span className="sr-only">Log out</span>
            </button>
          </div>
        </header>

        <form className="search-form" onSubmit={handleSearch}>
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search username"
            aria-label="Search username"
          />
          <button type="submit" disabled={searchBusy} title="Search">
            <Search size={18} />
          </button>
        </form>

        <div className="sidebar-scroll">
          {searchResult && (
            <>
              <div className="section-label">Search result</div>
              <div className="search-result">
                <div className="user-chip">
                  <Avatar name={searchResult.username} />
                  <strong>{searchResult.username}</strong>
                </div>
                {relation === "friends" && <span className="friends-tag">Friends</span>}
                {relation === "outgoing" && <span className="pending-tag">Pending</span>}
                {relation === "incoming" && <span className="pending-tag">Requested you</span>}
                {relation === "none" && (
                  <button
                    className="add-btn"
                    type="button"
                    onClick={() => sendFriendRequest(searchResult)}
                  >
                    <UserPlus size={14} />
                    Add
                  </button>
                )}
              </div>
            </>
          )}
          {searchStatus && <p className="search-status">{searchStatus}</p>}

          <div className="section-label">Requests</div>
          {incomingRequests.length === 0 && (
            <p className="empty-hint">No pending friend requests.</p>
          )}
          {incomingRequests.map((request) => (
            <div className="request-row" key={request.id}>
              <div className="user-chip">
                <Avatar name={request.fromUsername} />
                <strong>{request.fromUsername}</strong>
              </div>
              <div className="request-actions">
                <button
                  className="request-btn accept"
                  type="button"
                  onClick={() => acceptRequest(request)}
                  title="Accept"
                >
                  <Check size={14} />
                </button>
                <button
                  className="request-btn reject"
                  type="button"
                  onClick={() => rejectRequest(request)}
                  title="Reject"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}

          <div className="section-label">Friends</div>
          {friends.length === 0 && (
            <p className="empty-hint">Search a username to add your first friend.</p>
          )}
          {friends.map((friend) => {
            const unread = unreadByFriend[friend.uid] || 0;
            return (
              <button
                key={friend.uid}
                type="button"
                className={`friend-row${selectedFriend?.uid === friend.uid ? " active" : ""}${unread ? " unread" : ""}`}
                onClick={() => openChat(friend)}
              >
                <div className="user-chip">
                  <PresenceAvatar
                    name={friend.username}
                    online={isUserOnline(presenceByUid[friend.uid], nowTick)}
                  />
                  <strong>{friend.username}</strong>
                </div>
                {unread > 0 && (
                  <span className="unread-badge">{unread > 99 ? "99+" : unread}</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="chat-pane">
        {theme === "cyberpunk" && <CyberCity />}
        {theme === "sakura" && <SakuraTree />}
        {theme === "onepiece" && <OceanScene />}
        {selectedFriendLive ? (
          <>
            <header className="chat-header">
              <div className="chat-peer">
                <button
                  className="icon-btn back-btn"
                  type="button"
                  onClick={closeChat}
                  title="Back"
                >
                  <ArrowLeft size={18} />
                </button>
                <PresenceAvatar name={selectedFriendLive.username} online={friendOnline} />
                <div>
                  <strong>{selectedFriendLive.username}</strong>
                  <span
                    className={
                      friendTyping ? "typing-label" : friendOnline ? "online-label" : undefined
                    }
                  >
                    {friendStatus}
                  </span>
                </div>
              </div>
            </header>

            <div
              className="messages"
              ref={messagesListRef}
              onScroll={onMessagesScroll}
            >
              {chatError && (
                <p className="error-banner">
                  {chatError}
                  {chatErrorLink ? (
                    <>
                      {" "}
                      <a href={chatErrorLink} target="_blank" rel="noreferrer">
                        Create index
                      </a>
                    </>
                  ) : null}
                </p>
              )}
              {loadingOlder && <p className="history-status">Loading earlier messages…</p>}
              {!loadingOlder && !hasMoreOlder && messages.length > 0 && (
                <p className="history-status">Beginning of conversation</p>
              )}
              {messages.map((message, index) => {
                const mine = message.senderId === user.uid;
                const quoted = message.replyTo;
                const quotedMine = quoted?.senderId === user.uid;
                const groupStart =
                  index === 0 ||
                  index === unreadStartIndex ||
                  messages[index - 1].senderId !== message.senderId;
                const fresh = !historyIds.has(message.id);
                const links = menuMessageId === message.id ? findLinks(message.text) : [];
                return (
                  <Fragment key={message.id}>
                    {index === unreadStartIndex && (
                      <div className="unread-divider" ref={unreadDividerRef}>
                        <span>
                          {unreadDivider.count} unread{" "}
                          {unreadDivider.count === 1 ? "message" : "messages"}
                        </span>
                      </div>
                    )}
                    <div
                      className={`bubble-row ${mine ? "mine" : "theirs"}${groupStart ? " group-start" : ""}`}
                      id={`msg-${message.id}`}
                    >
                      <article
                        className={`bubble ${mine ? "mine" : "theirs"}${groupStart ? " tail" : ""}${fresh ? " pop-in" : ""}${message.deleted ? " deleted" : ""}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!message.deleted) setMenuMessageId(message.id);
                        }}
                      >
                        {message.deleted ? (
                          <p className="deleted-text">This message was deleted</p>
                        ) : (
                          <>
                            {quoted && (
                              <button
                                type="button"
                                className="reply-quote"
                                onClick={() => jumpToMessage(quoted.id)}
                              >
                                <strong>
                                  {quotedMine ? "You" : selectedFriendLive.username}
                                </strong>
                                <span>
                                  {quoted.deleted
                                    ? "This message was deleted"
                                    : quoted.text}
                                </span>
                              </button>
                            )}
                            <p>
                              <LinkifiedText text={message.text} />
                            </p>
                            <time>
                              {message.edited ? <em>edited </em> : null}
                              {formatTime(message.timestamp)}
                            </time>
                          </>
                        )}
                      </article>
                      {!message.deleted && (
                        <button
                          type="button"
                          className="bubble-more"
                          title="Message actions"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuMessageId((current) =>
                              current === message.id ? null : message.id,
                            );
                          }}
                        >
                          <MoreVertical size={16} />
                        </button>
                      )}
                      {menuMessageId === message.id && (
                        <div
                          className={`msg-menu ${mine ? "mine" : "theirs"}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button type="button" onClick={() => startReply(message)}>
                            <Reply size={14} />
                            Reply
                          </button>
                          <button type="button" onClick={() => copyText(message.text, "Message")}>
                            <Copy size={14} />
                            Copy
                          </button>
                          {links.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() => copyText(links[0].href, "Link")}
                              >
                                <Link size={14} />
                                Copy link
                              </button>
                              <button type="button" onClick={() => openLink(links[0].href)}>
                                <ExternalLink size={14} />
                                Open link
                              </button>
                            </>
                          )}
                          {mine && (
                            <button type="button" onClick={() => startEdit(message)}>
                              <Pencil size={14} />
                              Edit
                            </button>
                          )}
                          {mine && (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => deleteMessage(message)}
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
              {friendTyping && (
                <div className="bubble-row theirs group-start">
                  <article className="bubble theirs tail pop-in typing-bubble" aria-label="typing">
                    <span />
                    <span />
                    <span />
                  </article>
                </div>
              )}
            </div>

            <div className="composer-wrap">
              {replyingTo && (
                <div className="composer-context">
                  <div>
                    <strong>
                      Replying to{" "}
                      {replyingTo.senderId === user.uid
                        ? "yourself"
                        : selectedFriendLive.username}
                    </strong>
                    <span>
                      {replyingTo.deleted
                        ? "This message was deleted"
                        : snippet(replyingTo.text)}
                    </span>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setReplyingTo(null)}>
                    <X size={16} />
                  </button>
                </div>
              )}
              {editingMessage && (
                <div className="composer-context edit">
                  <div>
                    <strong>Editing message</strong>
                    <span>{snippet(editingMessage.text)}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => {
                      setEditingMessage(null);
                      setDraft("");
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <form className="composer" onSubmit={sendMessage}>
                <input
                  ref={composerInputRef}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  placeholder={editingMessage ? "Edit message" : "Type a message"}
                  aria-label="Message"
                  enterKeyHint="send"
                  autoComplete="off"
                />
                <button
                  className="composer-send"
                  type="submit"
                  disabled={!draft.trim()}
                  title={editingMessage ? "Save" : "Send"}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  {editingMessage ? <Check size={18} /> : <Send size={18} />}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="chat-empty">
            <MessageCircle size={48} />
            <h2>Select a friend to start chatting</h2>
            <p>Messages are saved in Firestore, so they stay available when you come back.</p>
          </div>
        )}
      </section>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
