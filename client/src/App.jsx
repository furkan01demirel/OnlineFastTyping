import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

function makeWSUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = import.meta.env.VITE_WS_HOST || "localhost:8080";
  return `${proto}://${host}`;
}

function Badge({ tone = "neutral", children }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export default function App() {
  const wsUrl = useMemo(() => makeWSUrl(), []);
  const wsRef = useRef(null);

  const [connStatus, setConnStatus] = useState("DISCONNECTED");
  const [wsReady, setWsReady] = useState(false);

  const [screen, setScreen] = useState("LOBBY");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  const [me, setMe] = useState({ playerId: null });
  const [room, setRoom] = useState(null);

  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    setConnStatus("CONNECTING");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnStatus("CONNECTED");
      setFeedback(null);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "WS_READY") setWsReady(true);

      if (msg.type === "ERROR") {
        setFeedback({ type: "error", text: msg.message || "Hata" });
      }

      if (msg.type === "JOINED") {
        setMe({ playerId: msg.data.playerId });
        setScreen("ROOM");
        setTyped("");
        setFeedback({ type: "ok", text: "Odaya girdin" });
      }

      if (msg.type === "ROOM_STATE") setRoom(msg.data);
    };

    ws.onclose = () => {
      setConnStatus("DISCONNECTED");
      setWsReady(false);
      setRoom(null);
      setScreen("LOBBY");
      setMe({ playerId: null });
      setFeedback({ type: "warn", text: "Bağlantı koptu. Sayfayı yenileyebilirsin." });
    };

    ws.onerror = () => {
      setFeedback({ type: "error", text: "WS bağlantı hatası" });
    };

    return () => {
      try { ws.close(); } catch {}
    };
  }, [wsUrl]);

  useEffect(() => {
    if (!room?.roundOpen) return;
    if (typed.trim() === room.currentWord) {
      send("SUBMIT_TYPED", { typed: typed.trim(), roundId: room.roundId });
    }
  }, [typed, room?.roundOpen, room?.currentWord, room?.roundId]);

  function send(type, data) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) {
      setFeedback({ type: "error", text: "WS hazır değil. Tekrar dene." });
      return;
    }
    ws.send(JSON.stringify({ type, data }));
  }

  const roomReadyInfo = (() => {
    if (!room) return { tone: "neutral", text: "Oda bilgisi bekleniyor" };
    if (room.players.length < 2) return { tone: "warn", text: "Oyuncu bekleniyor (en az 2 kişi katılınca oyun başlar)" };
    if (room.roundOpen) return { tone: "ok", text: "Round Açık: Yaz!" };
    if (room.roundWinnerId) return { tone: "warn", text: "Round bitti. Herkes 'Kelime Güncelle' basınca yeni kelime gelir." };
    return { tone: "warn", text: "Round başlamadı. Herkes 'Kelime Güncelle' basmalı." };
  })();

  const winner = room?.roundWinnerId
    ? room.players.find((p) => p.id === room.roundWinnerId)
    : null;

  const myPlayer = room?.players?.find((p) => p.id === me.playerId);

  return (
    <div className="page">
      {/* HEADER (EN TEPDE) */}
      <header className="topbar">
        <div className="topbarInner">
          <div className="headerLeft" />

          <div className="headerCenter">
            <div className="logo headerLogo">⌨️</div>
            <div className="headerText">
              <div className="headerTitle">Typing Race</div>
              <div className="headerSubtitle">En hızlı doğru yazan +1</div>
            </div>
          </div>

          <div className="headerRight">
            {(connStatus !== "CONNECTED" || !wsReady) ? (
              <div className="wsLoading" title="WebSocket hazırlanıyor...">
                <span className="spinner" />
                <span className="wsText">Bağlanıyor</span>
              </div>
            ) : (
              <div className="wsOk" title="WebSocket hazır">
                <span className="dot dot--ok" />
                <span className="wsText">Server Hazır</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="main">
        {screen === "LOBBY" && (
          <section className="card lobbyCard">
            <h2>Odaya Katıl</h2>
            <p className="muted">Aynı oda kodunu giren herkes aynı yarışa katılır.</p>

            <div className="formGrid">
              <label className="field">
                <span>İsim</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Furkan"
                  maxLength={20}
                />
              </label>

              <label className="field">
                <span>Oda Kodu</span>
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Örn: ABC1"
                  maxLength={8}
                />
              </label>
            </div>

            <button
              className="btn primary"
              disabled={!(connStatus === "CONNECTED" && wsReady && name.trim() && roomCode.trim())}
              onClick={() =>
                send("JOIN", {
                  name: name.trim(),
                  roomCode: roomCode.trim().toUpperCase(),
                })
              }
            >
              Odaya Gir
            </button>

            <div className="helper">
              {(connStatus !== "CONNECTED" || !wsReady) && (
                <div className="hint">
                  <span className="hintIcon">ℹ️</span>
                  WS hazır olmadan giriş yapılamaz.
                </div>
              )}
            </div>
          </section>
        )}

        {screen === "ROOM" && room && (
          <div className="roomGrid">
            <section className="card gameCard">
              <div className="gameHeader">
                <div className="gameHeaderLeft">
                  <h2>Yarış Alanı</h2>
                  <Badge tone={roomReadyInfo.tone}>{roomReadyInfo.text}</Badge>
                </div>

                <div className="gameHeaderRight">
                  <button
                    className="btn soft"
                    onClick={() => send("REQUEST_NEXT_WORD")}
                    disabled={!(connStatus === "CONNECTED" && wsReady)}
                    title="Herkes basınca yeni kelime gelir"
                    style={{display:"none"}}
                  >
                    Kelime Güncelle
                  </button>

                  <button
                    className="btn ghost"
                    onClick={() => {
                      send("LEAVE");
                      setScreen("LOBBY");
                      setRoom(null);
                      setMe({ playerId: null });
                      setTyped("");
                    }}
                  >
                    Çık
                  </button>
                </div>
              </div>

              <div className="wordBox">
                <div className="wordLabel">Yazılacak kelime</div>
                <div className="word">{room.currentWord}</div>

                {winner && (
                  <div className="winner">
                    🏁 <b>{winner.name}</b> bu round’u kazandı! (+1)
                  </div>
                )}
              </div>

              <div className="typingArea">
                <label className="field">
                  <span>Input (tek alan)</span>
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={room.roundOpen ? "Hızlıca yaz..." : "Round kapalıyken bekle..."}
                    disabled={!room.roundOpen}
                    autoFocus
                  />
                </label>

                <div className="miniRow">
                  <Badge tone={myPlayer?.isReadyForNext ? "ok" : "warn"}>
                    {myPlayer?.isReadyForNext ? "hazır" : "hazırlan"}
                  </Badge>

                  <Badge tone={room.allReady ? "ok" : "warn"}>
                    {room.allReady ? "Herkes hazır" : "Rakipler Bekleniyor"}
                  </Badge>

                  <Badge tone={room.roundOpen ? "ok" : "warn"}>
                    {room.roundOpen ? `Round #${room.roundId}` : `Round #${room.roundId}`}
                  </Badge>
                </div>

                <div className="actions">
                  <button
                    className="btn secondary"
                    onClick={() => send("SET_READY_NEXT")}
                    disabled={myPlayer?.isReadyForNext === true}
                  >
                    Hazırım
                  </button>

                  <button className="btn soft" onClick={() => setTyped("")} disabled={!typed}>
                    Temizle
                  </button>
                </div>
              </div>
            </section>

            <aside className="card sideCard">
              <h3>Skor Tablosu</h3>

              <div className="players">
                {room.players.map((p) => (
                  <div key={p.id} className={`playerRow ${p.id === me.playerId ? "me" : ""}`}>
                    <div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div>
                    <div className="pmeta">
                      <div className="pname">
                        {p.name} {p.id === me.playerId && <span className="you">(sen)</span>}
                      </div>
                      <div className="pbadges">
                        <Badge tone={p.isReadyForNext ? "ok" : "warn"}>
                          {p.isReadyForNext ? "Hazır" : "Bekliyor"}
                        </Badge>
                      </div>
                    </div>
                    <div className="pscore">{p.score}</div>
                  </div>
                ))}
              </div>

              <div className="divider" />

              <div className="tips">
                <div className="tipTitle">Nasıl oynanır?</div>
                <ul>
                  <li>Herkes <b>Kelime Güncelle</b> (veya <b>Hazırım</b>) basar.</li>
                  <li>Kelime değişince round açılır, input aktif olur.</li>
                  <li>İlk doğru yazan <b>+1</b> alır, round kapanır.</li>
                </ul>
              </div>
            </aside>
          </div>
        )}

        {feedback && <div className={`toast toast--${feedback.type}`}>{feedback.text}</div>}
      </main>
    </div>
  );
}
