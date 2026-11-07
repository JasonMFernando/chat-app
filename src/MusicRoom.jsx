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

  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const loadedVideoRef = useRef(null);
  const lastAppliedVersionRef = useRef(-1);
  const suppressUntilRef = useRef(0);
  const advancingRef = useRef(false);
  const queueRef = useRef([]);
  const roomRef = useRef(null);
  const hostRef = useRef(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    onActiveChange?.(Boolean(room?.active));
  }, [room?.active, onActiveChange]);

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

    const afterLoad = () => {
      try {
        player.seekTo(target, true);
        if (nextRoom.isPlaying) {
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
        window.setTimeout(afterLoad, 250);
      } catch {
        /* ignore */
      }
      return;
    }

    afterLoad();
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
    try {
      const player = playerRef.current;
      let positionSec = expectedPosition(room);
      try {
        const current = player?.getCurrentTime?.();
        if (typeof current === "number" && !Number.isNaN(current)) {
          positionSec = current;
        }
      } catch {
        /* ignore */
      }
      await writePlayback({
        isPlaying: !room.isPlaying,
        positionSec,
      });
    } catch (error) {
      setRoomError(error.message || "Playback update failed");
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
      onClose?.();
    } catch (error) {
      setRoomError(error.message || "Could not leave room");
    }
  }

  const current = room?.current;
  const showMiniBar = !open && audioReady && room?.active && current?.videoId;

  return (
    <>
      {audioReady && (
        <div className="yt-audio-host" aria-hidden="true">
          <div ref={hostRef} id={`yt-player-${chatId}`} />
        </div>
      )}

      {showMiniBar && (
        <button
          type="button"
          className="music-mini-bar"
          onClick={() => onOpen?.()}
          title="Open music room"
        >
          <span className="music-mini-art">
            {current.thumbnail ? <img src={current.thumbnail} alt="" /> : <ListMusic size={16} />}
          </span>
          <span className="music-mini-meta">
            <strong>{current.title}</strong>
            <span>{room.isPlaying ? "Playing together" : "Paused"}</span>
          </span>
          <ListMusic size={16} />
        </button>
      )}

      {open && (
        <div className="music-room" role="dialog" aria-label="Music room">
          <div className="music-room-panel">
            <header className="music-room-header">
              <div className="music-room-title">
                <ListMusic size={18} />
                <strong>Music room</strong>
              </div>
              <div className="music-room-header-actions">
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

            {!audioReady ? (
              <div className="music-audio-gate">
                <Volume2 size={28} />
                <p>Browsers block autoplay. Tap once to unlock synced audio.</p>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={async () => {
                    setAudioReady(true);
                    if (room?.current?.videoId && !room.isPlaying) {
                      try {
                        await writePlayback({
                          isPlaying: true,
                          positionSec: expectedPosition(room),
                        });
                      } catch {
                        /* player sync will still load the track */
                      }
                    }
                  }}
                >
                  Start listening
                </button>
              </div>
            ) : (
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
                  <span>{current?.channelTitle || "Add a song to get started"}</span>
                </div>
                <div className="music-controls">
                  <button
                    className="icon-btn music-ctrl"
                    type="button"
                    disabled={!current?.videoId || busy}
                    onClick={handlePlayPause}
                    title={room?.isPlaying ? "Pause" : "Play"}
                  >
                    {room?.isPlaying ? <Pause size={20} /> : <Play size={20} />}
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
                </div>
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
          </div>
        </div>
      )}
    </>
  );
}
