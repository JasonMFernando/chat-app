import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  SkipForward,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { db } from "./firebase.js";
import { loadYouTubeAPI, searchVideos } from "./youtube.js";

function expectedPosition(room) {
  if (!room) return 0;
  const base = Number(room.positionSec) || 0;
  if (!room.isPlaying) return base;
  const elapsed = (Date.now() - (Number(room.updatedAtMs) || Date.now())) / 1000;
  return Math.max(0, base + elapsed);
}

function trackPayload(track) {
  return {
    videoId: track.videoId,
    title: track.title,
    thumbnail: track.thumbnail || "",
    channelTitle: track.channelTitle || "",
  };
}

function formatTime(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function MusicRoom({
  chatId,
  user,
  friendUid,
  open,
  onClose,
  onOpen,
  onActiveChange,
}) {
  const [room, setRoom] = useState(null);
  const [queue, setQueue] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimisticPlaying, setOptimisticPlaying] = useState(null);
  const [progressSec, setProgressSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [scrubSec, setScrubSec] = useState(null);

  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const loadedVideoRef = useRef(null);
  const lastAppliedVersionRef = useRef(-1);
  const suppressUntilRef = useRef(0);
  const advancingRef = useRef(false);
  const queueRef = useRef([]);
  const roomRef = useRef(null);
  const hostRef = useRef(null);
  const scrubbingRef = useRef(false);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    roomRef.current = room;
    if (room && optimisticPlaying !== null && room.isPlaying === optimisticPlaying) {
      setOptimisticPlaying(null);
    }
  }, [room, optimisticPlaying]);

  useEffect(() => {
    onActiveChange?.(Boolean(room?.active));
  }, [room?.active, onActiveChange]);

  useEffect(() => {
    setAudioReady(false);
    setOptimisticPlaying(null);
    setProgressSec(0);
    setDurationSec(0);
    setScrubSec(null);
    scrubbingRef.current = false;
    setResults([]);
    setSearchTerm("");
    setSearchError("");
    setRoomError("");
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !user?.uid || !friendUid) return undefined;

    const roomDoc = doc(db, "musicRooms", chatId);
    const unsubRoom = onSnapshot(
      roomDoc,
      (snap) => {
        setRoom(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setRoomError("");
      },
      (error) => {
        setRoomError(error.message || "Could not load music room");
      },
    );

    const queueQuery = query(
      collection(db, "musicRooms", chatId, "queue"),
      orderBy("order", "asc"),
    );
    const unsubQueue = onSnapshot(
      queueQuery,
      (snap) => {
        setQueue(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (error) => {
        setRoomError(error.message || "Could not load queue");
      },
    );

    return () => {
      unsubRoom();
      unsubQueue();
    };
  }, [chatId, user?.uid, friendUid]);

  useEffect(() => {
    if (!open || !chatId || !user?.uid || !friendUid) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const roomDoc = doc(db, "musicRooms", chatId);
        const snap = await getDoc(roomDoc);
        if (cancelled) return;
        if (!snap.exists()) {
          await setDoc(roomDoc, {
            active: true,
            memberIds: [user.uid, friendUid].sort(),
            current: null,
            isPlaying: false,
            positionSec: 0,
            updatedAtMs: Date.now(),
            version: 0,
            updatedBy: user.uid,
          });
        } else if (!snap.data().active) {
          await updateDoc(roomDoc, {
            active: true,
            updatedBy: user.uid,
            updatedAtMs: Date.now(),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRoomError(error.message || "Could not open music room");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, chatId, user?.uid, friendUid]);

  useEffect(() => {
    if (!audioReady || !hostRef.current) return undefined;
    let disposed = false;

    (async () => {
      try {
        const YT = await loadYouTubeAPI();
        if (disposed || playerRef.current) return;

        playerRef.current = new YT.Player(hostRef.current, {
          height: "1",
          width: "1",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              playerReadyRef.current = true;
              const current = roomRef.current;
              if (current?.current?.videoId) {
                applyRoomState(current, true);
              }
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.ENDED) {
                handleTrackEnded(loadedVideoRef.current);
              }
            },
            onError: () => {
              handleTrackEnded(loadedVideoRef.current);
            },
          },
        });
      } catch (error) {
        setRoomError(error.message || "Could not start YouTube player");
      }
    })();

    return () => {
      disposed = true;
      playerReadyRef.current = false;
      loadedVideoRef.current = null;
      lastAppliedVersionRef.current = -1;
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create player once per audioReady session
  }, [audioReady, chatId]);

  function markLocalWrite() {
    suppressUntilRef.current = Date.now() + 900;
  }

  async function writePlayback(patch) {
    if (!chatId || !user?.uid) return;
    markLocalWrite();
    await updateDoc(doc(db, "musicRooms", chatId), {
      ...patch,
      updatedAtMs: Date.now(),
      version: increment(1),
      updatedBy: user.uid,
    });
  }

  function applyRoomState(nextRoom, force = false) {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current || !nextRoom) return;

    const version = Number(nextRoom.version) || 0;
    if (!force && version === lastAppliedVersionRef.current) return;
    if (!force && Date.now() < suppressUntilRef.current && nextRoom.updatedBy === user?.uid) {
      lastAppliedVersionRef.current = version;
      return;
    }

    lastAppliedVersionRef.current = version;
    const videoId = nextRoom.current?.videoId || null;
    const target = expectedPosition(nextRoom);

    if (!videoId) {
      try {
        player.stopVideo?.();
      } catch {
        /* ignore */
      }
      loadedVideoRef.current = null;
      return;
    }

    const syncPlayback = () => {
      try {
        if (nextRoom.isPlaying) {
          let currentTime = target;
          try {
            const live = player.getCurrentTime?.();
            if (typeof live === "number" && !Number.isNaN(live)) currentTime = live;
          } catch {
            /* ignore */
          }
          if (Math.abs(currentTime - target) > 1.5) {
            player.seekTo(target, true);
          }
          player.unMute?.();
          player.setVolume?.(100);
          player.playVideo();
        } else {
          player.pauseVideo();
        }
      } catch {
        /* ignore */
      }
    };

    if (loadedVideoRef.current !== videoId) {
      loadedVideoRef.current = videoId;
      try {
        player.loadVideoById({ videoId, startSeconds: target });
        window.setTimeout(syncPlayback, 250);
      } catch {
        /* ignore */
      }
      return;
    }

    syncPlayback();
  }

  useEffect(() => {
    if (!audioReady || !room) return;
    applyRoomState(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioReady, room?.version, room?.current?.videoId, room?.isPlaying]);

  async function handleTrackEnded(endedVideoId) {
    if (!chatId || !user?.uid || advancingRef.current || !endedVideoId) return;
    advancingRef.current = true;
    try {
      await advanceQueue(true, endedVideoId);
    } finally {
      window.setTimeout(() => {
        advancingRef.current = false;
      }, 600);
    }
  }

  async function advanceQueue(autoPlay, endedVideoId = null) {
    if (!chatId || !user?.uid) return;
    const roomDoc = doc(db, "musicRooms", chatId);
    const nextItem = queueRef.current[0] || null;
    markLocalWrite();

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomDoc);
      if (!snap.exists()) return;
      const data = snap.data();
      if (endedVideoId && data.current?.videoId !== endedVideoId) return;

      if (nextItem) {
        const itemRef = doc(db, "musicRooms", chatId, "queue", nextItem.id);
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists()) {
          tx.update(roomDoc, {
            current: null,
            isPlaying: false,
            positionSec: 0,
            updatedAtMs: Date.now(),
            version: (Number(data.version) || 0) + 1,
            updatedBy: user.uid,
          });
          return;
        }
        tx.delete(itemRef);
        tx.update(roomDoc, {
          current: trackPayload(nextItem),
          isPlaying: autoPlay,
          positionSec: 0,
          updatedAtMs: Date.now(),
          version: (Number(data.version) || 0) + 1,
          updatedBy: user.uid,
        });
      } else {
        tx.update(roomDoc, {
          current: null,
          isPlaying: false,
          positionSec: 0,
          updatedAtMs: Date.now(),
          version: (Number(data.version) || 0) + 1,
          updatedBy: user.uid,
        });
      }
    });
  }

  async function handlePlayPause() {
    if (!room?.current?.videoId || busy) return;
    setBusy(true);
    const player = playerRef.current;
    const currentlyPlaying = optimisticPlaying ?? Boolean(room.isPlaying);
    const nextPlaying = !currentlyPlaying;
    let positionSec = expectedPosition({
      ...room,
      isPlaying: currentlyPlaying,
    });
    try {
      const live = player?.getCurrentTime?.();
      if (typeof live === "number" && !Number.isNaN(live)) {
        positionSec = live;
      }
    } catch {
      /* ignore */
    }

    setOptimisticPlaying(nextPlaying);
    // Apply locally immediately — own Firestore writes are suppressed from re-applying
    try {
      if (nextPlaying) {
        player?.unMute?.();
        player?.playVideo?.();
      } else {
        player?.pauseVideo?.();
      }
    } catch {
      /* ignore */
    }

    try {
      await writePlayback({
        isPlaying: nextPlaying,
        positionSec,
      });
    } catch (error) {
      setOptimisticPlaying(currentlyPlaying);
      setRoomError(error.message || "Playback update failed");
      try {
        if (nextPlaying) player?.pauseVideo?.();
        else player?.playVideo?.();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip() {
    if (busy) return;
    setBusy(true);
    try {
      await advanceQueue(true);
    } catch (error) {
      setRoomError(error.message || "Skip failed");
    } finally {
      setBusy(false);
    }
  }

  function beginScrub(value) {
    scrubbingRef.current = true;
    setScrubSec(value);
  }

  function updateScrub(value) {
    scrubbingRef.current = true;
    setScrubSec(value);
    try {
      playerRef.current?.seekTo(value, true);
    } catch {
      /* ignore */
    }
  }

  async function commitSeek(rawValue) {
    if (!room?.current?.videoId) {
      scrubbingRef.current = false;
      setScrubSec(null);
      return;
    }
    const max = durationSec > 0 ? durationSec : Number(rawValue) || 0;
    const nextSec = Math.max(0, Math.min(Number(rawValue) || 0, max));
    const keepPlaying = optimisticPlaying ?? Boolean(room.isPlaying);

    scrubbingRef.current = false;
    setScrubSec(null);
    setProgressSec(nextSec);

    try {
      playerRef.current?.seekTo(nextSec, true);
      if (keepPlaying) {
        playerRef.current?.playVideo?.();
      } else {
        playerRef.current?.pauseVideo?.();
      }
    } catch {
      /* ignore */
    }

    try {
      await writePlayback({
        isPlaying: keepPlaying,
        positionSec: nextSec,
      });
    } catch (error) {
      setRoomError(error.message || "Seek failed");
    }
  }

  useEffect(() => {
    if (!audioReady || !room?.current?.videoId) {
      setProgressSec(0);
      setDurationSec(0);
      return undefined;
    }

    const tick = () => {
      if (scrubbingRef.current) return;
      const player = playerRef.current;
      try {
        const dur = player?.getDuration?.();
        if (typeof dur === "number" && !Number.isNaN(dur) && dur > 0) {
          setDurationSec(dur);
        }
        const live = player?.getCurrentTime?.();
        if (typeof live === "number" && !Number.isNaN(live)) {
          setProgressSec(live);
          return;
        }
      } catch {
        /* ignore */
      }
      if (roomRef.current) {
        setProgressSec(expectedPosition(roomRef.current));
      }
    };

    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [audioReady, room?.current?.videoId, room?.version, room?.isPlaying]);

  async function handleSearch(event) {
    event.preventDefault();
    if (!searchTerm.trim() || searchBusy) return;
    setSearchBusy(true);
    setSearchError("");
    try {
      const items = await searchVideos(searchTerm);
      setResults(items);
      if (items.length === 0) setSearchError("No videos found");
    } catch (error) {
      setResults([]);
      setSearchError(error.message || "Search failed");
    } finally {
      setSearchBusy(false);
    }
  }

  async function ensureRoomDoc() {
    const roomDoc = doc(db, "musicRooms", chatId);
    const snap = await getDoc(roomDoc);
    if (!snap.exists()) {
      await setDoc(roomDoc, {
        active: true,
        memberIds: [user.uid, friendUid].sort(),
        current: null,
        isPlaying: false,
        positionSec: 0,
        updatedAtMs: Date.now(),
        version: 0,
        updatedBy: user.uid,
      });
      return;
    }
    if (!snap.data().active) {
      await updateDoc(roomDoc, {
        active: true,
        updatedBy: user.uid,
        updatedAtMs: Date.now(),
      });
    }
  }

  async function addToQueue(track) {
    if (!chatId || !user?.uid || busy) return;
    setBusy(true);
    try {
      await ensureRoomDoc();
      if (!room?.current?.videoId) {
        markLocalWrite();
        await updateDoc(doc(db, "musicRooms", chatId), {
          current: trackPayload(track),
          isPlaying: audioReady,
          positionSec: 0,
          updatedAtMs: Date.now(),
          version: increment(1),
          updatedBy: user.uid,
          active: true,
        });
      } else {
        const order = Date.now();
        await addDoc(collection(db, "musicRooms", chatId, "queue"), {
          ...trackPayload(track),
          addedBy: user.uid,
          addedAt: serverTimestamp(),
          order,
        });
      }
      setResults((prev) => prev.filter((item) => item.videoId !== track.videoId));
    } catch (error) {
      setRoomError(error.message || "Could not add track");
    } finally {
      setBusy(false);
    }
  }

  async function removeFromQueue(itemId) {
    if (!chatId || busy) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "musicRooms", chatId, "queue", itemId));
    } catch (error) {
      setRoomError(error.message || "Could not remove track");
    } finally {
      setBusy(false);
    }
  }

  async function leaveRoom() {
    if (!chatId || !user?.uid) return;
    try {
      try {
        playerRef.current?.stopVideo?.();
      } catch {
        /* ignore */
      }
      await updateDoc(doc(db, "musicRooms", chatId), {
        active: false,
        isPlaying: false,
        updatedAtMs: Date.now(),
        updatedBy: user.uid,
      });
      setAudioReady(false);
      setOptimisticPlaying(null);
      onClose?.();
    } catch (error) {
      setRoomError(error.message || "Could not leave room");
    }
  }

  const current = room?.current;
  const isPlaying = optimisticPlaying ?? Boolean(room?.isPlaying);
  const showDock = open || Boolean(room?.active);
  const seekValue = scrubSec ?? progressSec;
  const seekMax = Math.max(durationSec || 0, seekValue, 1);
  const canSeek = Boolean(audioReady && current?.videoId);

  const seekControls = (
    <div className="music-seek">
      <span className="music-seek-time">{formatTime(seekValue)}</span>
      <input
        className="music-seek-range"
        type="range"
        min={0}
        max={seekMax}
        step={0.25}
        value={Math.min(seekValue, seekMax)}
        disabled={!canSeek}
        aria-label="Seek"
        onPointerDown={(event) => beginScrub(Number(event.currentTarget.value))}
        onChange={(event) => updateScrub(Number(event.target.value))}
        onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
            commitSeek(Number(event.currentTarget.value));
          }
        }}
      />
      <span className="music-seek-time">{formatTime(durationSec)}</span>
    </div>
  );

  return (
    <>
      {audioReady && (
        <div className="yt-audio-host" aria-hidden="true">
          <div ref={hostRef} id={`yt-player-${chatId}`} />
        </div>
      )}

      {showDock && (
        <div className="music-dock">
          <div className="music-strip">
            <button
              type="button"
              className="music-strip-main"
              onClick={() => (open ? onClose?.() : onOpen?.())}
              title={open ? "Hide panel" : "Show queue & search"}
            >
              <span className="music-strip-art" aria-hidden="true">
                {current?.thumbnail ? (
                  <img src={current.thumbnail} alt="" />
                ) : (
                  <ListMusic size={16} />
                )}
              </span>
              <span className="music-strip-meta">
                <strong>{current?.title || "Music room"}</strong>
                <span>
                  {!audioReady
                    ? "Tap Start to listen"
                    : current?.videoId
                      ? isPlaying
                        ? "Playing together"
                        : "Paused"
                      : "Add a song to start"}
                </span>
              </span>
            </button>

            <div className="music-strip-actions">
              {!audioReady ? (
                <button
                  className="primary-btn music-start-btn"
                  type="button"
                  onClick={async () => {
                    setAudioReady(true);
                    onOpen?.();
                    if (room?.current?.videoId && !room.isPlaying) {
                      try {
                        setOptimisticPlaying(true);
                        await writePlayback({
                          isPlaying: true,
                          positionSec: expectedPosition(room),
                        });
                      } catch {
                        setOptimisticPlaying(null);
                      }
                    }
                  }}
                >
                  <Volume2 size={14} />
                  Start
                </button>
              ) : (
                <>
                  <button
                    className="icon-btn music-ctrl"
                    type="button"
                    disabled={!current?.videoId || busy}
                    onClick={handlePlayPause}
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <button
                    className="icon-btn music-ctrl"
                    type="button"
                    disabled={busy || (!current?.videoId && queue.length === 0)}
                    onClick={handleSkip}
                    title="Skip"
                  >
                    <SkipForward size={18} />
                  </button>
                </>
              )}
              <button
                className="icon-btn"
                type="button"
                onClick={() => (open ? onClose?.() : onOpen?.())}
                title={open ? "Close panel" : "Open panel"}
              >
                {open ? <X size={18} /> : <ListMusic size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          className="music-side-overlay"
          onClick={() => onClose?.()}
          role="presentation"
        >
          <aside
            className="music-side-panel"
            role="dialog"
            aria-label="Music room"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="music-side-header">
              <div className="music-room-title">
                <ListMusic size={18} />
                <strong>Music room</strong>
              </div>
              <div className="music-side-header-actions">
                <button className="text-btn" type="button" onClick={leaveRoom}>
                  Leave
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => onClose?.()}
                  title="Close panel"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {roomError && <p className="error-banner music-room-error">{roomError}</p>}

            <div className="music-now-playing">
              <div className="music-art" aria-hidden="true">
                {current?.thumbnail ? (
                  <img src={current.thumbnail} alt="" />
                ) : (
                  <ListMusic size={28} />
                )}
              </div>
              <div className="music-now-meta">
                <strong>{current?.title || "Nothing playing"}</strong>
                <span>{current?.channelTitle || "Search and add a song"}</span>
              </div>
              <div className="music-controls">
                {!audioReady ? (
                  <button
                    className="primary-btn music-start-btn"
                    type="button"
                    onClick={async () => {
                      setAudioReady(true);
                      if (room?.current?.videoId && !room.isPlaying) {
                        try {
                          setOptimisticPlaying(true);
                          await writePlayback({
                            isPlaying: true,
                            positionSec: expectedPosition(room),
                          });
                        } catch {
                          setOptimisticPlaying(null);
                        }
                      }
                    }}
                  >
                    <Volume2 size={14} />
                    Start
                  </button>
                ) : (
                  <>
                    <button
                      className="icon-btn music-ctrl"
                      type="button"
                      disabled={!current?.videoId || busy}
                      onClick={handlePlayPause}
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                    </button>
                    <button
                      className="icon-btn music-ctrl"
                      type="button"
                      disabled={busy || (!current?.videoId && queue.length === 0)}
                      onClick={handleSkip}
                      title="Skip"
                    >
                      <SkipForward size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {canSeek && seekControls}

            {!audioReady && (
              <div className="music-audio-gate compact">
                <p>Browsers block autoplay. Tap Start to unlock synced audio.</p>
              </div>
            )}

            <form className="music-search" onSubmit={handleSearch}>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search YouTube"
                aria-label="Search YouTube"
              />
              <button type="submit" disabled={searchBusy || !searchTerm.trim()} title="Search">
                {searchBusy ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              </button>
            </form>
            {searchError && <p className="search-status">{searchError}</p>}

            {results.length > 0 && (
              <div className="music-section">
                <div className="section-label">Search results</div>
                <ul className="music-list">
                  {results.map((item) => (
                    <li key={item.videoId} className="music-list-item">
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" className="music-thumb" />
                      ) : (
                        <span className="music-thumb placeholder" />
                      )}
                      <div className="music-list-meta">
                        <strong>{item.title}</strong>
                        <span>{item.channelTitle}</span>
                      </div>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Add to queue"
                        disabled={busy}
                        onClick={() => addToQueue(item)}
                      >
                        <Plus size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="music-section music-queue">
              <div className="section-label">Queue ({queue.length})</div>
              {queue.length === 0 ? (
                <p className="empty-hint">Queue is empty</p>
              ) : (
                <ul className="music-list">
                  {queue.map((item) => (
                    <li key={item.id} className="music-list-item">
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" className="music-thumb" />
                      ) : (
                        <span className="music-thumb placeholder" />
                      )}
                      <div className="music-list-meta">
                        <strong>{item.title}</strong>
                        <span>{item.channelTitle}</span>
                      </div>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Remove"
                        disabled={busy}
                        onClick={() => removeFromQueue(item.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
