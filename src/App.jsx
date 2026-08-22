import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  arrayUnion,
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
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
  LogOut,
  MessageCircle,
  Search,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import { auth, db } from "./firebase.js";
import "./App.css";

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
      return "Firestore needs an index for this query. Open the browser console and click the link to create it.";
    default:
      return error?.message || "Something went wrong. Try again.";
  }
}

function sortMessages(docs) {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      // Pending local writes have no timestamp yet — keep them at the bottom.
      const ta = a.timestamp?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
      const tb = b.timestamp?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
}

function Avatar({ name, className = "" }) {
  return (
    <div className={`avatar ${className}`.trim()} aria-hidden="true">
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
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
  const [draft, setDraft] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [incomingMessages, setIncomingMessages] = useState([]);
  const [localReadAt, setLocalReadAt] = useState({});
  const [unreadDivider, setUnreadDivider] = useState(null);

  const messagesListRef = useRef(null);
  const unreadDividerRef = useRef(null);
  const alignedForFriend = useRef(null);
  const friends = profile?.friends || [];

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
        setIncomingMessages([]);
        setLocalReadAt({});
        setUnreadDivider(null);
        setChatError("");
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

    const inboxQuery = query(
      collection(db, "chats"),
      where("receiverId", "==", user.uid),
    );
    const unsubInbox = onSnapshot(inboxQuery, (snap) => {
      setIncomingMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubProfile();
      unsubIncoming();
      unsubOutgoing();
      unsubInbox();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !selectedFriend) {
      setMessages([]);
      return undefined;
    }

    const chatId = getChatId(user.uid, selectedFriend.uid);
    // Equality-only query so it works without a composite index.
    // Sort by timestamp on the client instead of orderBy().
    const messagesQuery = query(
      collection(db, "chats"),
      where("chatId", "==", chatId),
    );

    const unsubMessages = onSnapshot(
      messagesQuery,
      (snap) => {
        setMessages(sortMessages(snap.docs));
        setChatError("");
      },
      (error) => {
        setChatError(authErrorMessage(error));
      },
    );

    return () => unsubMessages();
  }, [user, selectedFriend]);

  useEffect(() => {
    alignedForFriend.current = null;
  }, [selectedFriend]);

  useLayoutEffect(() => {
    const list = messagesListRef.current;
    if (!list || messages.length === 0) return undefined;

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
  }, [messages, unreadDivider, selectedFriend]);

  const openChatIncomingCount = incomingMessages.filter(
    (message) => message.senderId === selectedFriend?.uid,
  ).length;

  useEffect(() => {
    if (!user || !selectedFriend) return undefined;
    updateDoc(doc(db, "users", user.uid), {
      [`lastReadAt.${selectedFriend.uid}`]: serverTimestamp(),
    }).catch(() => {});
  }, [user, selectedFriend, openChatIncomingCount]);

  const unreadByFriend = useMemo(() => {
    const counts = {};
    for (const friend of friends) {
      if (selectedFriend?.uid === friend.uid) {
        counts[friend.uid] = 0;
        continue;
      }
      const savedRead = profile?.lastReadAt?.[friend.uid]?.toMillis?.() ?? 0;
      const lastReadMs = Math.max(savedRead, localReadAt[friend.uid] ?? 0);
      counts[friend.uid] = incomingMessages.filter((message) => {
        if (message.senderId !== friend.uid) return false;
        const sentAt = message.timestamp?.toMillis?.() ?? Date.now();
        return sentAt > lastReadMs;
      }).length;
    }
    return counts;
  }, [friends, incomingMessages, localReadAt, profile, selectedFriend]);

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
    await signOut(auth);
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
    const savedRead = profile?.lastReadAt?.[friend.uid]?.toMillis?.() ?? 0;
    const lastReadMs = Math.max(savedRead, localReadAt[friend.uid] ?? 0);
    const unread = incomingMessages.filter((message) => {
      if (message.senderId !== friend.uid) return false;
      const sentAt = message.timestamp?.toMillis?.() ?? Date.now();
      return sentAt > lastReadMs;
    }).length;

    setUnreadDivider(
      unread > 0
        ? { friendUid: friend.uid, afterMs: lastReadMs, count: unread }
        : null,
    );
    setSelectedFriend(friend);
    setMobileShowChat(true);
    setDraft("");
    setLocalReadAt((prev) => ({ ...prev, [friend.uid]: Date.now() }));
  }

  function closeChat() {
    setMobileShowChat(false);
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!user || !selectedFriend) return;

    const text = draft.trim();
    if (!text) return;

    setSendBusy(true);
    setChatError("");
    try {
      await addDoc(collection(db, "chats"), {
        senderId: user.uid,
        receiverId: selectedFriend.uid,
        text,
        timestamp: serverTimestamp(),
        chatId: getChatId(user.uid, selectedFriend.uid),
      });
      setDraft("");
    } catch (error) {
      setChatError(authErrorMessage(error));
    } finally {
      setSendBusy(false);
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
        <div className="auth-screen">
          <div className="auth-card">
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
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="user-chip">
            <Avatar name={profile?.username} className="green" />
            <div>
              <strong>{profile?.username || "…"}</strong>
              <span>{profile?.email || user.email}</span>
            </div>
          </div>
          <button className="icon-btn" type="button" onClick={handleLogout} title="Log out">
            <LogOut size={18} />
            <span className="sr-only">Log out</span>
          </button>
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
                  <Avatar name={friend.username} />
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
                <Avatar name={selectedFriendLive.username} />
                <div>
                  <strong>{selectedFriendLive.username}</strong>
                  <span>Friend</span>
                </div>
              </div>
            </header>

            <div className="messages" ref={messagesListRef}>
              {chatError && <p className="error-banner">{chatError}</p>}
              {messages.map((message, index) => (
                <Fragment key={message.id}>
                  {index === unreadStartIndex && (
                    <div className="unread-divider" ref={unreadDividerRef}>
                      <span>
                        {unreadDivider.count} unread{" "}
                        {unreadDivider.count === 1 ? "message" : "messages"}
                      </span>
                    </div>
                  )}
                  <article
                    className={`bubble ${message.senderId === user.uid ? "mine" : "theirs"}`}
                  >
                    <p>{message.text}</p>
                    <time>{formatTime(message.timestamp)}</time>
                  </article>
                </Fragment>
              ))}
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message"
                aria-label="Message"
              />
              <button type="submit" disabled={sendBusy || !draft.trim()} title="Send">
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div className="chat-empty">
            <MessageCircle size={48} />
            <h2>Select a friend to start chatting</h2>
            <p>Messages are saved in Firestore, so they stay available when you come back.</p>
          </div>
        )}
      </section>
    </div>
  );
}
