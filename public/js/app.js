'use strict';
/* ─────────────────────────────────────────────────
   ひらがジャン プロトタイプ
   - PeerJS で2人対戦 (公開ブローカー利用)
   - ルール: 簡略七対子
     手牌7 → ツモで8 → 4ペアで上がり / 揃わなければ1枚捨てて7
     牌: ひらがな23字 × 4 = 92枚
   ───────────────────────────────────────────────── */

// ── 牌定義 (23字 × 4 = 92枚) ──────────────────────
const CHARS = ['あ','い','う','え','お','か','き','く','け','こ',
               'さ','し','す','せ','そ','た','ち','つ','て','と','な','に','ぬ'];
const COPIES = 4;
const HAND_SIZE = 7;

// ── アプリ状態 ─────────────────────────────────────
const S = {
  screen: 'home',   // 'home' | 'create' | 'join' | 'game' | 'result'
  peer: null,       // PeerJS instance
  conn: null,       // active DataConnection
  myId: null,       // PeerJS ID
  roomCode: null,   // 表示用ルームコード (= myId の末尾 or 入力)
  isHost: false,    // ホスト=配牌役
  // ── ゲーム状態 ──
  wall: [],         // 山牌
  myHand: [],       // 自分の手牌 (ソート済)
  oppHandCount: 0,  // 相手の手牌枚数
  myDiscards: [],
  oppDiscards: [],
  myTurn: false,
  drawn: null,      // ツモった牌 (まだ捨てる前)
  winner: null,     // 'me' | 'opp' | 'draw'
  winHand: null,    // 上がり時の手牌スナップ
  log: [],
  // ── UI ──
  inputCode: '',
};

// ── ユーティリティ ─────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'amp;','"':'&quot;'}[c]));
const sortHand = h => [...h].sort((a,b)=>CHARS.indexOf(a)-CHARS.indexOf(b));

function buildWall() {
  const w = [];
  for (const c of CHARS) for (let i=0;i<COPIES;i++) w.push(c);
  for (let i=w.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [w[i],w[j]] = [w[j],w[i]];
  }
  return w;
}

// 上がり判定: 8枚で4ペア (七対子簡易版・4ペア)
function isWin(tiles) {
  if (tiles.length !== HAND_SIZE+1) return false;
  const cnt = {};
  for (const t of tiles) cnt[t] = (cnt[t]||0)+1;
  let pairs = 0;
  for (const k in cnt) {
    if (cnt[k] === 2) pairs++;
    else if (cnt[k] === 4) pairs += 2; // 同字4枚は2ペア扱い
    else return false; // 1枚 or 3枚あれば不成立
  }
  return pairs === 4;
}

// ── レンダリング ───────────────────────────────────
function render() {
  const app = $('app');
  app.innerHTML =
    S.screen === 'home'   ? renderHome() :
    S.screen === 'create' ? renderCreate() :
    S.screen === 'join'   ? renderJoin() :
    S.screen === 'game'   ? renderGame() :
    S.screen === 'result' ? renderResult() : '';
  bind();
}

function renderHome() {
  return `<div class="screen home">
    <div class="title">ひらがジャン</div>
    <div class="subtitle">2人対戦・七対子の簡易版</div>
    <button class="btn primary" id="btn-create">ルーム作成</button>
    <button class="btn" id="btn-join">ルームに参加</button>
    <div class="rule-card">
      <div class="rule-title">遊び方</div>
      <ol>
        <li>1人がルーム作成→6桁コードを共有</li>
        <li>もう1人がコード入力で参加</li>
        <li>順番に牌を引いて捨てる</li>
        <li>手牌8枚で「4組ペア」が揃ったら勝ち</li>
      </ol>
    </div>
  </div>`;
}

function renderCreate() {
  const ready = !!S.roomCode && !!S.conn;
  return `<div class="screen wait">
    <div class="title">ルーム作成中</div>
    ${S.roomCode
      ? `<div class="code-box">
          <div class="code-label">ルームコード</div>
          <div class="code">${S.roomCode}</div>
          <button class="btn small" id="btn-copy">コピー</button>
        </div>
        <div class="status">${ready ? '相手が参加しました！配牌中…' : '相手の参加を待っています…'}</div>`
      : `<div class="status">接続準備中...</div>`}
    <button class="btn small ghost" id="btn-back">戻る</button>
  </div>`;
}

function renderJoin() {
  return `<div class="screen join">
    <div class="title">ルームに参加</div>
    <div class="form">
      <label>ルームコード (6桁)</label>
      <input type="text" id="code-input" maxlength="6" autocomplete="off" placeholder="例: ABC123" value="${S.inputCode}">
      <button class="btn primary" id="btn-connect">接続する</button>
      <button class="btn small ghost" id="btn-back">戻る</button>
    </div>
    <div class="status" id="join-status"></div>
  </div>`;
}

function tileHTML(t, opts={}) {
  const cls = ['tile'];
  if (opts.drawn) cls.push('drawn');
  if (opts.back) cls.push('back');
  if (opts.discard) cls.push('discard');
  const data = opts.idx != null ? `data-idx="${opts.idx}"` : '';
  const action = opts.action ? `data-action="${opts.action}"` : '';
  return `<div class="${cls.join(' ')}" ${data} ${action}>${opts.back?'':esc(t)}</div>`;
}

function renderGame() {
  const oppTiles = Array.from({length:S.oppHandCount}, () => tileHTML('', {back:true})).join('');
  const myTiles = S.myHand.map((t,i) => tileHTML(t, {idx:i, action:'discard'})).join('');
  const drawnTile = S.drawn ? tileHTML(S.drawn, {drawn:true, action:'discard-drawn'}) : '';
  const myDis = S.myDiscards.map(t => tileHTML(t, {discard:true})).join('');
  const oppDis = S.oppDiscards.map(t => tileHTML(t, {discard:true})).join('');
  const turnLabel = S.myTurn
    ? (S.drawn ? 'あなたのターン: 1枚捨てる' : 'あなたのターン: ツモ')
    : '相手のターン...';
  const wallCount = S.wall.length;
  return `<div class="screen game">
    <div class="bar top">
      <div class="bar-side">残り山:${wallCount}</div>
      <div class="bar-mid ${S.myTurn?'my-turn':''}">${turnLabel}</div>
      <div class="bar-side"><button class="btn xs ghost" id="btn-quit">終了</button></div>
    </div>

    <div class="opp-area">
      <div class="hand-label">相手の手牌 (${S.oppHandCount})</div>
      <div class="hand opp">${oppTiles}</div>
      <div class="discards-label">相手の捨て牌</div>
      <div class="discards">${oppDis||'<span class="muted">なし</span>'}</div>
    </div>

    <div class="middle">
      ${S.myTurn && !S.drawn ? `<button class="big-btn" id="btn-draw">ツモ</button>` : ''}
      ${S.myTurn && S.drawn ? `<div class="hint">ツモった牌か手牌のどれかをタップして捨てる</div>` : ''}
    </div>

    <div class="me-area">
      <div class="discards-label">自分の捨て牌</div>
      <div class="discards">${myDis||'<span class="muted">なし</span>'}</div>
      <div class="hand-label">自分の手牌</div>
      <div class="hand me">
        ${myTiles}
        ${drawnTile ? `<div class="gap"></div>${drawnTile}` : ''}
      </div>
      ${S.myTurn && S.drawn && isWin([...S.myHand, S.drawn]) ? `<button class="big-btn win" id="btn-win">あがり！🎉</button>` : ''}
    </div>
  </div>`;
}

function renderResult() {
  const msg = S.winner === 'me' ? '🎉 あなたの勝ち！' :
              S.winner === 'opp' ? '😢 相手の勝ち' : '🤝 引き分け（流局）';
  const handDisp = S.winHand ? S.winHand.map(t=>tileHTML(t)).join('') : '';
  return `<div class="screen result">
    <div class="title">${msg}</div>
    ${handDisp ? `<div class="hand-label">勝ち手</div><div class="hand result-hand">${handDisp}</div>` : ''}
    <button class="btn primary" id="btn-rematch">もう一回</button>
    <button class="btn" id="btn-home">ホームへ</button>
  </div>`;
}

// ── イベントバインド ───────────────────────────────
function bind() {
  // ── ホーム
  $('btn-create')?.addEventListener('click', startCreate);
  $('btn-join')?.addEventListener('click', () => { S.screen='join'; render(); });
  // ── 戻る共通
  $('btn-back')?.addEventListener('click', goHome);
  $('btn-quit')?.addEventListener('click', () => {
    if (confirm('対戦を終了しますか？')) goHome();
  });
  // ── ルーム作成 コピー
  $('btn-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(S.roomCode).then(()=>alert('コピーしました'));
  });
  // ── ルーム参加
  $('code-input')?.addEventListener('input', e => { S.inputCode = e.target.value.toUpperCase(); e.target.value = S.inputCode; });
  $('btn-connect')?.addEventListener('click', startJoin);
  // ── ゲーム
  $('btn-draw')?.addEventListener('click', doDraw);
  document.querySelectorAll('[data-action="discard"]').forEach(el => {
    el.addEventListener('click', e => {
      const i = Number(e.currentTarget.dataset.idx);
      doDiscardFromHand(i);
    });
  });
  document.querySelector('[data-action="discard-drawn"]')?.addEventListener('click', doDiscardDrawn);
  $('btn-win')?.addEventListener('click', declareWin);
  // ── 結果
  $('btn-rematch')?.addEventListener('click', rematch);
  $('btn-home')?.addEventListener('click', goHome);
}

// ── 画面遷移ヘルパー ───────────────────────────────
function goHome() {
  cleanupPeer();
  S.screen = 'home';
  S.roomCode = null;
  S.isHost = false;
  S.winner = null;
  S.winHand = null;
  render();
}

function cleanupPeer() {
  try { S.conn?.close(); } catch(_) {}
  try { S.peer?.destroy(); } catch(_) {}
  S.conn = null; S.peer = null; S.myId = null;
}

// ── PeerJS: ルーム作成 ─────────────────────────────
function startCreate() {
  S.screen = 'create';
  S.isHost = true;
  S.roomCode = null;
  render();

  // 6桁の英数字コードを生成 (PeerJS ID として登録)
  const code = randomCode();
  const peer = new Peer('hiragajan-' + code);
  S.peer = peer;

  peer.on('open', id => {
    S.roomCode = code;
    render();
  });
  peer.on('connection', conn => {
    S.conn = conn;
    setupConnHandlers();
    conn.on('open', () => {
      // ホスト: 配牌してゲーム開始
      startGame();
    });
  });
  peer.on('error', err => {
    console.error('Peer error:', err);
    alert('接続エラー: ' + (err.type || err.message || err));
    goHome();
  });
}

// ── PeerJS: ルーム参加 ─────────────────────────────
function startJoin() {
  const code = (S.inputCode||'').trim().toUpperCase();
  if (code.length !== 6) { alert('6桁のコードを入力してください'); return; }
  S.isHost = false;
  const status = $('join-status');
  if (status) status.textContent = '接続中...';

  const peer = new Peer();
  S.peer = peer;
  peer.on('open', () => {
    const conn = peer.connect('hiragajan-' + code, {reliable:true});
    S.conn = conn;
    conn.on('open', () => {
      setupConnHandlers();
      // ホストからの配牌を待つ
      S.screen = 'game';
      S.myTurn = false;
      render();
    });
    conn.on('error', err => {
      if (status) status.textContent = '接続失敗: ' + (err.type||err.message||err);
    });
  });
  peer.on('error', err => {
    if (status) status.textContent = '接続エラー: ' + (err.type||err.message||err);
  });
}

function setupConnHandlers() {
  S.conn.on('data', onMessage);
  S.conn.on('close', () => {
    alert('相手との接続が切れました');
    goHome();
  });
}

function randomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 紛らわしい文字除外
  let s = '';
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

// ── ゲーム開始 (ホスト側) ──────────────────────────
function startGame() {
  S.wall = buildWall();
  // 配牌: 自分7枚, 相手7枚
  const myH = sortHand(S.wall.splice(0, HAND_SIZE));
  const oppH = S.wall.splice(0, HAND_SIZE);
  S.myHand = myH;
  S.oppHandCount = HAND_SIZE;
  S.myDiscards = [];
  S.oppDiscards = [];
  S.drawn = null;
  S.winner = null; S.winHand = null;
  S.myTurn = true; // ホストが先攻
  S.screen = 'game';
  // 相手に「ゲーム開始」と相手の手牌を送る
  send({type:'init', oppHand: oppH, wall: S.wall, opponentTurn: false});
  render();
}

// ── メッセージ受信 ─────────────────────────────────
function onMessage(msg) {
  switch (msg.type) {
    case 'init': {
      // クライアント側: 配牌を受信
      S.myHand = sortHand(msg.oppHand);
      S.oppHandCount = HAND_SIZE;
      S.wall = msg.wall || [];
      S.myDiscards = [];
      S.oppDiscards = [];
      S.drawn = null;
      S.winner = null; S.winHand = null;
      S.myTurn = msg.opponentTurn;
      S.screen = 'game';
      render();
      break;
    }
    case 'draw': {
      // 相手がツモった (山が1減る)
      S.wall = msg.wall || S.wall;
      S.oppHandCount = msg.oppHandCount;
      render();
      break;
    }
    case 'discard': {
      // 相手が捨てた
      S.oppDiscards.push(msg.tile);
      S.oppHandCount = msg.oppHandCount;
      S.wall = msg.wall || S.wall;
      S.myTurn = true; // 自分のターン
      render();
      break;
    }
    case 'win': {
      // 相手が上がった
      S.winner = 'opp';
      S.winHand = msg.hand;
      S.screen = 'result';
      render();
      break;
    }
    case 'draw_game': {
      // 流局
      S.winner = 'draw';
      S.screen = 'result';
      render();
      break;
    }
    case 'rematch_request': {
      if (confirm('相手がもう一度プレイしたいと言っています。OK？')) {
        if (S.isHost) startGame();
        else send({type:'rematch_ok'});
      } else {
        send({type:'rematch_no'});
        goHome();
      }
      break;
    }
    case 'rematch_ok': {
      if (S.isHost) startGame();
      break;
    }
    case 'rematch_no': {
      alert('相手は再戦を断りました');
      goHome();
      break;
    }
  }
}

function send(msg) {
  try { S.conn?.send(msg); } catch(e) { console.error('send fail', e); }
}

// ── ターン操作 ─────────────────────────────────────
function doDraw() {
  if (!S.myTurn || S.drawn) return;
  if (S.wall.length === 0) {
    // 流局
    send({type:'draw_game'});
    S.winner = 'draw';
    S.screen = 'result';
    render();
    return;
  }
  S.drawn = S.wall.shift();
  send({type:'draw', wall:S.wall, oppHandCount:S.oppHandCount});
  render();
}

function doDiscardFromHand(idx) {
  if (!S.myTurn || !S.drawn) return;
  const tile = S.myHand[idx];
  // 手牌から捨てる→ツモった牌が手牌に入る
  S.myHand.splice(idx, 1);
  S.myHand.push(S.drawn);
  S.myHand = sortHand(S.myHand);
  S.drawn = null;
  S.myDiscards.push(tile);
  S.myTurn = false;
  send({type:'discard', tile, wall:S.wall, oppHandCount:S.oppHandCount});
  render();
}

function doDiscardDrawn() {
  if (!S.myTurn || !S.drawn) return;
  const tile = S.drawn;
  S.drawn = null;
  S.myDiscards.push(tile);
  S.myTurn = false;
  send({type:'discard', tile, wall:S.wall, oppHandCount:S.oppHandCount});
  render();
}

function declareWin() {
  if (!S.drawn) return;
  const hand = sortHand([...S.myHand, S.drawn]);
  if (!isWin(hand)) { alert('上がり形ではありません'); return; }
  S.winner = 'me';
  S.winHand = hand;
  S.screen = 'result';
  send({type:'win', hand});
  render();
}

function rematch() {
  if (!S.conn) { goHome(); return; }
  send({type:'rematch_request'});
  alert('相手の同意を待っています...');
}

// ── 起動 ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', render);
