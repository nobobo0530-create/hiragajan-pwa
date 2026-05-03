'use strict';
/* ─────────────────────────────────────────────────
   ひらがジャン v2 (麻雀風)
   - 手牌13、ツモ→14で「4面子+1雀頭」or「7対子」で上がり
   - 面子: 順子 (連続3) または 刻子 (同字3)
   - ポン: 相手の捨て牌で刻子作成 (要2枚)
   - ロン: 相手の捨て牌で上がり
   - ツモ: 自分が引いた牌で上がり
   - 通信: PeerJS / ソロモード(AI)対応
   ───────────────────────────────────────────────── */

// ── 牌セット定義 ────────────────────────────────────
const CHAR_SETS = {
  easy: ['あ','い','う','え','お','か','き','く','け','こ'],
  std:  ['あ','い','う','え','お','か','き','く','け','こ',
         'さ','し','す','せ','そ','た','ち','つ','て','と','な','に','ぬ'],
  full: ['あ','い','う','え','お','か','き','く','け','こ',
         'さ','し','す','せ','そ','た','ち','つ','て','と',
         'な','に','ぬ','ね','の','は','ひ','ふ','へ','ほ',
         'ま','み','む','め','も','や','ゆ','よ','ら','り','る','れ','ろ','わ','を','ん'],
};
const COPIES = 4;
const HAND_SIZE = 13;

// ── アプリ状態 ─────────────────────────────────────
const S = {
  screen: 'home',     // 'home'|'create'|'join'|'config'|'game'|'result'
  configMode: null,   // 'create'|'solo' (config画面のあと何をするか)
  difficulty: 'std',  // 'easy'|'std'|'full'
  // 通信
  peer: null, conn: null, roomCode: null, isHost: false,
  // ゲーム
  wall: [],
  myHand: [],          // 隠し手牌 (ソート済)
  myMelds: [],         // 公開面子 [{tiles:['あ','あ','あ'], type:'pon'|'run', from:'opp'}]
  oppHandCount: 0,
  oppMelds: [],
  myDiscards: [],
  oppDiscards: [],
  myTurn: false,
  drawn: null,         // ツモ牌
  lastDiscard: null,   // 直前の相手の捨て牌 (ポン/ロン判定用)
  pendingClaim: false, // 相手の捨て牌に対するポン/ロン待ち
  winner: null, winHand: null, winType: null, // 'tsumo'|'ron'
  // ソロ
  solo: false, oppHand: [], aiTimer: null,
  // UI
  inputCode: '',
};

// ── ユーティリティ ─────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const chars = () => CHAR_SETS[S.difficulty];
const charIdx = t => chars().indexOf(t);
const sortHand = h => [...h].sort((a,b) => charIdx(a) - charIdx(b));

function buildWall(diff) {
  const cs = CHAR_SETS[diff];
  const w = [];
  for (const c of cs) for (let i=0;i<COPIES;i++) w.push(c);
  for (let i=w.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [w[i],w[j]] = [w[j],w[i]];
  }
  return w;
}

// ── 上がり判定 ────────────────────────────────────
// 面子=3枚(順子or刻子) を再帰的に探す
function canFormSets(tiles, n) {
  // tiles: ソート済配列, n: 残り何面子作ればいいか
  if (n === 0) return tiles.length === 0;
  if (tiles.length < 3) return false;
  const t = tiles[0];
  const i = charIdx(t);
  // 試行1: 刻子 (同字3)
  if (tiles[1] === t && tiles[2] === t) {
    if (canFormSets(tiles.slice(3), n-1)) return true;
  }
  // 試行2: 順子 (i, i+1, i+2)
  const cs = chars();
  if (i+2 < cs.length) {
    const next1 = cs[i+1], next2 = cs[i+2];
    const i1 = tiles.indexOf(next1, 1);
    if (i1 > 0) {
      const i2 = tiles.indexOf(next2, i1+1);
      if (i2 > 0) {
        const rest = tiles.filter((_,k) => k!==0 && k!==i1 && k!==i2);
        if (canFormSets(rest, n-1)) return true;
      }
    }
  }
  return false;
}

// 4面子+1雀頭
function isStandardWin(tiles) {
  if (tiles.length % 3 !== 2) return false;
  const sorted = sortHand(tiles);
  // 各雀頭候補を試す
  const seen = new Set();
  for (let i=0;i<sorted.length-1;i++) {
    if (seen.has(sorted[i])) continue;
    if (sorted[i] !== sorted[i+1]) continue;
    seen.add(sorted[i]);
    const rest = sorted.filter((_,k) => k!==i && k!==i+1);
    if (canFormSets(rest, (tiles.length-2)/3)) return true;
  }
  return false;
}

// 七対子: 14枚で7ペア (面子なし時のみ)
function isSevenPairs(tiles) {
  if (tiles.length !== 14) return false;
  const cnt = {};
  for (const t of tiles) cnt[t] = (cnt[t]||0)+1;
  let pairs = 0;
  for (const k in cnt) {
    if (cnt[k] === 2) pairs++;
    else if (cnt[k] === 4) pairs += 2;
    else return false;
  }
  return pairs === 7;
}

// 完全な上がり判定: 隠し手牌+ツモ/ロン牌 + 公開面子
function checkWin(concealed, melds, extra) {
  const all = sortHand([...concealed, extra]);
  const setsNeeded = 4 - melds.length;
  if (setsNeeded < 0) return false;
  // 七対子: 公開面子なしの時のみ
  if (melds.length === 0 && isSevenPairs(all)) return true;
  // 標準形: 隠し牌で (setsNeeded面子+1雀頭)
  if (all.length !== setsNeeded * 3 + 2) return false;
  // 雀頭探索
  const seen = new Set();
  for (let i=0;i<all.length-1;i++) {
    if (seen.has(all[i])) continue;
    if (all[i] !== all[i+1]) continue;
    seen.add(all[i]);
    const rest = all.filter((_,k) => k!==i && k!==i+1);
    if (canFormSets(rest, setsNeeded)) return true;
  }
  return false;
}

// ポン可能判定: 隠し手牌に同じ牌が2枚以上あるか
function canPon(concealed, tile) {
  return concealed.filter(t => t === tile).length >= 2;
}

// ── レンダリング ───────────────────────────────────
function render() {
  const app = $('app');
  app.innerHTML =
    S.screen === 'home'   ? renderHome() :
    S.screen === 'config' ? renderConfig() :
    S.screen === 'create' ? renderCreate() :
    S.screen === 'join'   ? renderJoin() :
    S.screen === 'game'   ? renderGame() :
    S.screen === 'result' ? renderResult() : '';
  bind();
}

function renderHome() {
  return `<div class="screen home">
    <div class="title">ひらがジャン</div>
    <div class="subtitle">ひらがな麻雀・2人対戦</div>
    <button class="btn primary" id="btn-create">ルーム作成</button>
    <button class="btn" id="btn-join">ルームに参加</button>
    <button class="btn ghost" id="btn-solo">🤖 1人で試す (AI対戦)</button>
    <div class="rule-card">
      <div class="rule-title">あがりかた</div>
      <ul>
        <li><b>4面子1雀頭</b>: 3枚組×4 + ペア×1</li>
        <li>面子=順子(あいう・かきく等の連続) または 刻子(あああ等の同字3)</li>
        <li><b>七対子</b>: ペア×7 (面子0のとき)</li>
        <li><b>ツモ</b>: 自分のツモで上がり</li>
        <li><b>ロン</b>: 相手の捨て牌で上がり</li>
        <li><b>ポン</b>: 相手の捨てを取って刻子作成</li>
      </ul>
    </div>
  </div>`;
}

function renderConfig() {
  const titleByMode = S.configMode === 'solo' ? '1人で試す' : 'ルーム作成';
  return `<div class="screen config">
    <div class="title">${titleByMode}</div>
    <div class="subtitle">難易度を選んでください</div>
    <div class="diff-list">
      <button class="diff-btn ${S.difficulty==='easy'?'on':''}" data-diff="easy">
        <div class="diff-name">かんたん</div>
        <div class="diff-meta">10字 × 4 = 40枚 (短時間)</div>
      </button>
      <button class="diff-btn ${S.difficulty==='std'?'on':''}" data-diff="std">
        <div class="diff-name">ふつう</div>
        <div class="diff-meta">23字 × 4 = 92枚 (標準)</div>
      </button>
      <button class="diff-btn ${S.difficulty==='full'?'on':''}" data-diff="full">
        <div class="diff-name">ほんかく</div>
        <div class="diff-meta">46字 × 4 = 184枚 (長時間)</div>
      </button>
    </div>
    <button class="btn primary" id="btn-config-go">この難易度で開始</button>
    <button class="btn small ghost" id="btn-back">戻る</button>
  </div>`;
}

function renderCreate() {
  return `<div class="screen wait">
    <div class="title">ルーム作成中</div>
    ${S.roomCode
      ? `<div class="code-box">
          <div class="code-label">ルームコード</div>
          <div class="code">${S.roomCode}</div>
          <button class="btn small" id="btn-copy">コピー</button>
        </div>
        <div class="status">${S.conn ? '相手が参加しました！配牌中…' : '相手の参加を待っています…'}</div>`
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

// ── 手牌グルーピング表示 ────────────────────────────
// 同字を視覚的にまとめ、連続も色分けする
function renderGroupedHand(tiles, options={}) {
  const action = options.action ? options.action : '';
  const cs = chars();
  let lastChar = null;
  let groupColor = 0;
  const html = tiles.map((t, i) => {
    let cls = 'tile';
    // グルーピング: 直前と同字 or 連続なら同じ色
    if (lastChar !== null) {
      const lastIdx = cs.indexOf(lastChar);
      const curIdx = cs.indexOf(t);
      if (lastChar === t || curIdx === lastIdx + 1) {
        // 同グループ
      } else {
        groupColor = (groupColor + 1) % 4;
      }
    }
    cls += ' g' + groupColor;
    lastChar = t;
    const data = action ? `data-idx="${i}" data-action="${action}"` : '';
    return `<div class="${cls}" ${data}>${esc(t)}</div>`;
  }).join('');
  return html;
}

function renderMelds(melds) {
  if (!melds || melds.length === 0) return '';
  return melds.map(m =>
    `<div class="meld">${m.tiles.map(t => `<div class="tile small open">${esc(t)}</div>`).join('')}</div>`
  ).join('<span class="meld-sep"></span>');
}

function renderDiscards(list, lastIdx=-1) {
  return list.map((t,i) => {
    const cls = 'tile discard' + (i===lastIdx ? ' last' : '');
    return `<div class="${cls}">${esc(t)}</div>`;
  }).join('');
}

function renderGame() {
  const oppBacks = Array.from({length:S.oppHandCount}, () => `<div class="tile back small"></div>`).join('');
  const myDis = renderDiscards(S.myDiscards);
  const oppDis = renderDiscards(S.oppDiscards, S.lastDiscard ? S.oppDiscards.length-1 : -1);

  // ターン表示・操作ボタン
  let turnLabel, actionArea = '';
  if (S.pendingClaim) {
    // 相手の捨て牌に対するポン/ロン判定中
    const tile = S.lastDiscard;
    const ronOK = checkWin(S.myHand, S.myMelds, tile);
    const ponOK = canPon(S.myHand, tile);
    turnLabel = `相手の「${tile}」に対する応答`;
    actionArea = `<div class="action-row">
      ${ronOK ? `<button class="big-btn win" id="btn-ron">🏆 ロン</button>` : ''}
      ${ponOK ? `<button class="big-btn alt" id="btn-pon">ポン</button>` : ''}
      <button class="big-btn skip" id="btn-skip">スキップ</button>
    </div>`;
  } else if (S.myTurn && !S.drawn) {
    turnLabel = 'あなたの番: ツモ';
    actionArea = `<button class="big-btn" id="btn-draw">ツモ</button>`;
  } else if (S.myTurn && S.drawn) {
    const tsumoOK = checkWin(S.myHand, S.myMelds, S.drawn);
    turnLabel = '捨てる牌をタップ';
    actionArea = tsumoOK ? `<button class="big-btn win" id="btn-tsumo">🏆 ツモあがり</button>` : `<div class="hint">手牌かツモ牌をタップして捨てる</div>`;
  } else {
    turnLabel = '相手の番...';
  }

  const drawnTile = S.drawn ? `<div class="tile drawn" data-action="discard-drawn">${esc(S.drawn)}</div>` : '';

  return `<div class="screen game">
    <!-- 上部: 残り山・ターン・終了 -->
    <div class="bar top">
      <div class="bar-side">山:${S.wall.length}</div>
      <div class="bar-mid ${S.myTurn||S.pendingClaim?'my-turn':''}">${turnLabel}</div>
      <div class="bar-side"><button class="btn xs ghost" id="btn-quit">終了</button></div>
    </div>

    <!-- 相手エリア -->
    <div class="opp-area">
      <div class="player-label">
        <span>相手</span>
        <span class="muted">手牌${S.oppHandCount}枚</span>
      </div>
      <div class="hand-row">
        <div class="concealed">${oppBacks}</div>
        <div class="melds">${renderMelds(S.oppMelds)}</div>
      </div>
      <div class="discards-zone">
        <div class="zone-label">相手の捨て牌</div>
        <div class="discards">${oppDis||'<span class="muted">なし</span>'}</div>
      </div>
    </div>

    <!-- 中央: 操作 -->
    <div class="center-zone">
      ${actionArea}
    </div>

    <!-- 自分エリア -->
    <div class="me-area">
      <div class="discards-zone">
        <div class="zone-label">自分の捨て牌</div>
        <div class="discards">${myDis||'<span class="muted">なし</span>'}</div>
      </div>
      <div class="melds">${renderMelds(S.myMelds)}</div>
      <div class="player-label">
        <span>自分</span>
        <span class="muted">手牌${S.myHand.length}枚${S.drawn?' +1':''}</span>
      </div>
      <div class="hand-row">
        <div class="concealed mine">${renderGroupedHand(S.myHand, {action:'discard-hand'})}</div>
        ${drawnTile ? `<div class="drawn-wrap">${drawnTile}</div>` : ''}
      </div>
    </div>
  </div>`;
}

function renderResult() {
  let msg, sub = '';
  if (S.winner === 'me')        { msg = '🎉 あなたの勝ち！'; sub = S.winType==='tsumo'?'ツモ':'ロン'; }
  else if (S.winner === 'opp')  { msg = '😢 相手の勝ち';     sub = S.winType==='tsumo'?'ツモ':'ロン'; }
  else                          { msg = '🤝 流局 (引き分け)'; }
  const handDisp = S.winHand
    ? `<div class="hand-row center"><div class="concealed">${renderGroupedHand(S.winHand)}</div></div>`
    : '';
  const meldsDisp = S.winner && S.winMelds && S.winMelds.length
    ? `<div class="melds center">${renderMelds(S.winMelds)}</div>` : '';
  return `<div class="screen result">
    <div class="title">${msg}</div>
    ${sub ? `<div class="sub-result">${sub}</div>` : ''}
    ${handDisp}
    ${meldsDisp}
    <button class="btn primary" id="btn-rematch">もう一回</button>
    <button class="btn" id="btn-home">ホームへ</button>
  </div>`;
}

// ── イベントバインド ───────────────────────────────
function bind() {
  // ホーム
  $('btn-create')?.addEventListener('click', () => { S.configMode='create'; S.screen='config'; render(); });
  $('btn-join')?.addEventListener('click', () => { S.screen='join'; render(); });
  $('btn-solo')?.addEventListener('click', () => { S.configMode='solo'; S.screen='config'; render(); });
  // 設定
  document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', e => {
    S.difficulty = e.currentTarget.dataset.diff;
    render();
  }));
  $('btn-config-go')?.addEventListener('click', () => {
    if (S.configMode === 'solo') startSolo();
    else startCreate();
  });
  // 戻る
  $('btn-back')?.addEventListener('click', goHome);
  $('btn-quit')?.addEventListener('click', () => { if (confirm('対戦を終了しますか？')) goHome(); });
  // コピー・参加
  $('btn-copy')?.addEventListener('click', () => navigator.clipboard?.writeText(S.roomCode).then(()=>alert('コピーしました')));
  $('code-input')?.addEventListener('input', e => { S.inputCode = e.target.value.toUpperCase(); e.target.value = S.inputCode; });
  $('btn-connect')?.addEventListener('click', startJoin);
  // ゲーム操作
  $('btn-draw')?.addEventListener('click', doDraw);
  $('btn-tsumo')?.addEventListener('click', doTsumo);
  $('btn-pon')?.addEventListener('click', doPon);
  $('btn-ron')?.addEventListener('click', doRon);
  $('btn-skip')?.addEventListener('click', doSkipClaim);
  document.querySelectorAll('[data-action="discard-hand"]').forEach(el => {
    el.addEventListener('click', e => doDiscardFromHand(Number(e.currentTarget.dataset.idx)));
  });
  document.querySelector('[data-action="discard-drawn"]')?.addEventListener('click', doDiscardDrawn);
  // 結果
  $('btn-rematch')?.addEventListener('click', rematch);
  $('btn-home')?.addEventListener('click', goHome);
}

// ── 画面遷移 ───────────────────────────────────────
function goHome() {
  cleanupPeer();
  clearTimeout(S.aiTimer);
  S.aiTimer = null; S.solo = false; S.oppHand = [];
  S.screen = 'home'; S.roomCode = null; S.isHost = false;
  S.winner = null; S.winHand = null; S.winType = null; S.winMelds = null;
  S.myHand = []; S.myMelds = []; S.oppMelds = [];
  S.myDiscards = []; S.oppDiscards = [];
  S.drawn = null; S.lastDiscard = null; S.pendingClaim = false;
  render();
}

function cleanupPeer() {
  try { S.conn?.close(); } catch(_) {}
  try { S.peer?.destroy(); } catch(_) {}
  S.conn = null; S.peer = null;
}

// ── PeerJS: ルーム作成 ─────────────────────────────
function startCreate() {
  S.screen = 'create'; S.isHost = true; S.roomCode = null;
  render();
  const code = randomCode();
  const peer = new Peer('hiragajan-' + code);
  S.peer = peer;
  peer.on('open', () => { S.roomCode = code; render(); });
  peer.on('connection', conn => {
    S.conn = conn;
    setupConnHandlers();
    conn.on('open', () => { send({type:'config', difficulty:S.difficulty}); startGame(); });
  });
  peer.on('error', err => { alert('接続エラー: '+(err.type||err.message)); goHome(); });
}

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
      S.screen = 'game'; S.myTurn = false; render();
    });
    conn.on('error', err => { if (status) status.textContent = '接続失敗: '+(err.type||err.message); });
  });
  peer.on('error', err => { if (status) status.textContent = '接続エラー: '+(err.type||err.message); });
}

function setupConnHandlers() {
  S.conn.on('data', onMessage);
  S.conn.on('close', () => { alert('相手との接続が切れました'); goHome(); });
}

function randomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

// ── ゲーム開始 (ホスト) ────────────────────────────
function startGame() {
  S.wall = buildWall(S.difficulty);
  const myH = sortHand(S.wall.splice(0, HAND_SIZE));
  const oppH = S.wall.splice(0, HAND_SIZE);
  S.myHand = myH; S.oppHandCount = HAND_SIZE;
  S.myMelds = []; S.oppMelds = [];
  S.myDiscards = []; S.oppDiscards = [];
  S.drawn = null; S.lastDiscard = null; S.pendingClaim = false;
  S.winner = null; S.winHand = null; S.winType = null;
  S.myTurn = true;
  S.screen = 'game';
  send({type:'init', oppHand: oppH, wall: S.wall, opponentTurn: false, difficulty: S.difficulty});
  render();
}

// ── メッセージ受信 ─────────────────────────────────
function onMessage(msg) {
  switch (msg.type) {
    case 'config':
      S.difficulty = msg.difficulty || S.difficulty;
      break;
    case 'init':
      S.difficulty = msg.difficulty || S.difficulty;
      S.myHand = sortHand(msg.oppHand);
      S.oppHandCount = HAND_SIZE;
      S.wall = msg.wall || [];
      S.myMelds = []; S.oppMelds = [];
      S.myDiscards = []; S.oppDiscards = [];
      S.drawn = null; S.lastDiscard = null; S.pendingClaim = false;
      S.winner = null; S.winHand = null; S.winType = null;
      S.myTurn = msg.opponentTurn;
      S.screen = 'game';
      render();
      break;
    case 'draw':
      // 相手がツモった
      S.wall = msg.wall || S.wall;
      S.oppHandCount = msg.oppHandCount;
      render();
      break;
    case 'discard':
      // 相手が捨てた → 自分にポン/ロンの選択肢
      S.oppDiscards.push(msg.tile);
      S.oppHandCount = msg.oppHandCount;
      S.wall = msg.wall || S.wall;
      S.lastDiscard = msg.tile;
      S.pendingClaim = true; // ポン/ロン待ち
      render();
      break;
    case 'pon':
      // 相手がポンした
      S.oppMelds.push({tiles:[msg.tile,msg.tile,msg.tile], type:'pon'});
      S.oppDiscards.pop(); // 捨て牌から戻る
      S.oppHandCount -= 2; // 2枚消費
      S.lastDiscard = null;
      // 相手がポンしたので、相手は捨てる
      S.myTurn = false;
      render();
      break;
    case 'skip':
      // 相手がスキップ → 自分の番
      S.lastDiscard = null;
      S.myTurn = true;
      render();
      break;
    case 'tsumo':
      S.winner = 'opp'; S.winType = 'tsumo';
      S.winHand = msg.hand; S.winMelds = msg.melds || [];
      S.screen = 'result';
      render();
      break;
    case 'ron':
      S.winner = 'opp'; S.winType = 'ron';
      S.winHand = msg.hand; S.winMelds = msg.melds || [];
      S.screen = 'result';
      render();
      break;
    case 'draw_game':
      S.winner = 'draw'; S.screen = 'result'; render();
      break;
    case 'rematch_request':
      if (confirm('相手がもう一度プレイしたいと言っています。OK?')) {
        if (S.isHost) startGame(); else send({type:'rematch_ok'});
      } else { send({type:'rematch_no'}); goHome(); }
      break;
    case 'rematch_ok': if (S.isHost) startGame(); break;
    case 'rematch_no': alert('相手は再戦を断りました'); goHome(); break;
  }
}

function send(msg) { try { S.conn?.send(msg); } catch(e){} }

// ── ターン操作 ─────────────────────────────────────
function doDraw() {
  if (!S.myTurn || S.drawn || S.pendingClaim) return;
  if (S.wall.length === 0) {
    if (!S.solo) send({type:'draw_game'});
    S.winner = 'draw'; S.screen = 'result'; render(); return;
  }
  S.drawn = S.wall.shift();
  if (!S.solo) send({type:'draw', wall:S.wall, oppHandCount:S.oppHandCount});
  render();
}

function doDiscardFromHand(idx) {
  if (!S.myTurn) return;
  // ツモ/ポン後の捨て牌
  const tile = S.myHand[idx];
  S.myHand.splice(idx, 1);
  if (S.drawn) {
    S.myHand.push(S.drawn);
    S.myHand = sortHand(S.myHand);
    S.drawn = null;
  }
  finishDiscard(tile);
}

function doDiscardDrawn() {
  if (!S.myTurn || !S.drawn) return;
  const tile = S.drawn;
  S.drawn = null;
  finishDiscard(tile);
}

function finishDiscard(tile) {
  S.myDiscards.push(tile);
  S.myTurn = false;
  if (!S.solo) send({type:'discard', tile, wall:S.wall, oppHandCount:S.oppHandCount});
  render();
  scheduleAi(); // ソロのときAI応答
}

function doTsumo() {
  if (!S.drawn) return;
  if (!checkWin(S.myHand, S.myMelds, S.drawn)) { alert('上がり形ではありません'); return; }
  const hand = sortHand([...S.myHand, S.drawn]);
  S.winner = 'me'; S.winType = 'tsumo';
  S.winHand = hand; S.winMelds = [...S.myMelds];
  S.screen = 'result';
  if (!S.solo) send({type:'tsumo', hand, melds:S.myMelds});
  render();
}

function doRon() {
  if (!S.pendingClaim || S.lastDiscard == null) return;
  const tile = S.lastDiscard;
  if (!checkWin(S.myHand, S.myMelds, tile)) { alert('上がり形ではありません'); return; }
  const hand = sortHand([...S.myHand, tile]);
  S.winner = 'me'; S.winType = 'ron';
  S.winHand = hand; S.winMelds = [...S.myMelds];
  S.screen = 'result';
  if (!S.solo) send({type:'ron', hand, melds:S.myMelds});
  render();
}

function doPon() {
  if (!S.pendingClaim || S.lastDiscard == null) return;
  const tile = S.lastDiscard;
  if (!canPon(S.myHand, tile)) return;
  // 手牌から2枚抜いて公開面子に
  let removed = 0;
  S.myHand = S.myHand.filter(t => {
    if (t === tile && removed < 2) { removed++; return false; }
    return true;
  });
  S.myMelds.push({tiles:[tile,tile,tile], type:'pon'});
  S.pendingClaim = false;
  S.lastDiscard = null;
  S.myTurn = true;
  S.drawn = null;
  if (!S.solo) send({type:'pon', tile});
  render();
  // ポン後は捨てる必要あり (drawnなしで手牌から選択)
}

function doSkipClaim() {
  if (!S.pendingClaim) return;
  S.pendingClaim = false;
  S.lastDiscard = null;
  S.myTurn = true;
  if (!S.solo) send({type:'skip'});
  render();
}

// ── ソロモード (AI) ────────────────────────────────
function startSolo() {
  S.solo = true; S.isHost = false;
  S.wall = buildWall(S.difficulty);
  S.myHand = sortHand(S.wall.splice(0, HAND_SIZE));
  S.oppHand = S.wall.splice(0, HAND_SIZE);
  S.oppHandCount = HAND_SIZE;
  S.myMelds = []; S.oppMelds = [];
  S.myDiscards = []; S.oppDiscards = [];
  S.drawn = null; S.lastDiscard = null; S.pendingClaim = false;
  S.winner = null; S.winHand = null; S.winType = null;
  S.myTurn = true;
  S.screen = 'game';
  render();
}

function scheduleAi() {
  if (!S.solo) return;
  clearTimeout(S.aiTimer);
  S.aiTimer = setTimeout(aiTurn, 800);
}

function aiTurn() {
  if (!S.solo || S.winner) return;
  // AIロン判定 (自分の捨てた最新牌で)
  const myLastDis = S.myDiscards[S.myDiscards.length-1];
  if (myLastDis && checkWin(S.oppHand, S.oppMelds, myLastDis)) {
    const hand = sortHand([...S.oppHand, myLastDis]);
    S.winner = 'opp'; S.winType = 'ron';
    S.winHand = hand; S.winMelds = [...S.oppMelds];
    S.screen = 'result'; render(); return;
  }
  // AIポン判定 (50%確率で)
  if (myLastDis && canPon(S.oppHand, myLastDis) && Math.random() < 0.5) {
    let removed = 0;
    S.oppHand = S.oppHand.filter(t => {
      if (t === myLastDis && removed < 2) { removed++; return false; }
      return true;
    });
    S.oppMelds.push({tiles:[myLastDis,myLastDis,myLastDis], type:'pon'});
    S.oppHandCount = S.oppHand.length;
    // ポン後すぐ捨て
    aiDiscard();
    return;
  }
  // AIツモ
  if (S.wall.length === 0) {
    S.winner = 'draw'; S.screen = 'result'; render(); return;
  }
  const drawn = S.wall.shift();
  S.oppHand.push(drawn);
  // ツモあがり判定
  if (checkWin(S.oppHand.slice(0, -1), S.oppMelds, drawn)) {
    const hand = sortHand([...S.oppHand]);
    S.winner = 'opp'; S.winType = 'tsumo';
    S.winHand = hand; S.winMelds = [...S.oppMelds];
    S.screen = 'result'; render(); return;
  }
  aiDiscard();
}

function aiDiscard() {
  // シンプルAI: 孤立牌(1枚もの)優先で捨てる
  const cnt = {};
  for (const t of S.oppHand) cnt[t] = (cnt[t]||0)+1;
  const singles = S.oppHand.filter(t => cnt[t] === 1);
  const tile = singles.length > 0
    ? singles[Math.floor(Math.random()*singles.length)]
    : S.oppHand[Math.floor(Math.random()*S.oppHand.length)];
  const idx = S.oppHand.indexOf(tile);
  S.oppHand.splice(idx, 1);
  S.oppDiscards.push(tile);
  S.oppHandCount = S.oppHand.length;
  S.lastDiscard = tile;
  // プレイヤーにポン/ロンの選択肢
  if (canPon(S.myHand, tile) || checkWin(S.myHand, S.myMelds, tile)) {
    S.pendingClaim = true;
    S.myTurn = false;
  } else {
    S.lastDiscard = null;
    S.myTurn = true;
  }
  render();
}

function rematch() {
  if (S.solo) { startSolo(); return; }
  if (!S.conn) { goHome(); return; }
  send({type:'rematch_request'});
  alert('相手の同意を待っています...');
}

// ── 起動 ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', render);
