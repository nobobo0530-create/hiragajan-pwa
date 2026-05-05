'use strict';
/* ─────────────────────────────────────────────────
   ひらがジャン v3 (単語ゲーム版)
   - ひらがな牌で意味のある「単語」を作って上がる
   - 手牌7枚 → ツモで8枚 → 単語に分割できればあがり
   - 例: 「あんこ」+「ねこ」+「は」(2字以上必須なので残れば不可)
       → 「あんこ」+「ねこ」+「うえ」+(?) など7字で完成
   - ロン: 相手の捨て牌を使ってあがり
   - ポンは廃止 (単語ゲームには不要)
   ───────────────────────────────────────────────── */

// ── ひらがな辞書 (基本46 + 濁音20 + 半濁音5 = 71字) ──
const BASIC = ['あ','い','う','え','お','か','き','く','け','こ',
               'さ','し','す','せ','そ','た','ち','つ','て','と',
               'な','に','ぬ','ね','の','は','ひ','ふ','へ','ほ',
               'ま','み','む','め','も','や','ゆ','よ',
               'ら','り','る','れ','ろ','わ','を','ん'];
const DAKU  = ['が','ぎ','ぐ','げ','ご','ざ','じ','ず','ぜ','ぞ',
               'だ','ぢ','づ','で','ど','ば','び','ぶ','べ','ぼ'];
const HANDA = ['ぱ','ぴ','ぷ','ぺ','ぽ'];
const ALL_CHARS = [...BASIC, ...DAKU, ...HANDA];

// 牌セット (難易度別)
const CHAR_SETS = {
  easy: BASIC,                     // 46字 (濁音/半濁音なし、子供向け)
  std:  [...BASIC, ...DAKU],       // 66字
  full: ALL_CHARS,                 // 71字
};
const COPIES = 2;
const HAND_SIZE = 13;

// ── 単語辞書 (~250語の常用ひらがな単語) ─────────────
const WORDS_RAW = `
あい あお あか あき あさ あし あに あね あめ あり
いえ いき いし いす いと いぬ いま いみ
うえ うた うち うで うみ うり うん
えき えん おに おの おも おや
かい かう かお かき かさ かに かみ かめ かわ
きく きつ きぬ きん くち くつ くも くろ
けし けむ けん こい こえ こめ
さい さけ さら さん しお しろ しん
すき すし すな ずつ せき せみ せん そら
たい たこ たて たね たま ちか ちず
つき つえ つの つる てら てん
とき とり となり なみ なつ にし にく ぬの
ねこ のろ はい はく はち はな はね はる
ひと ひる ふえ ふた ふゆ へや ほし ほね ほん
まえ まち まめ まる みず みみ みち みせ
むし むら めし もも もり やま やね
ゆき ゆめ ゆり よる よこ
りす るす れい ろう わた わに
あんこ あんず あんま いちご いとこ いるか
うさぎ うちわ うどん えがお えだまめ
おかし おさけ おちゃ おとこ おとな おばけ おりがみ
かいだん かたな かばん かるた かけら
きしゃ きつね きのこ くじら くるま
けいと げんき
こども ことば
さくら さしみ さんま ざぶとん
しごと しずく じてん
すずめ すいか すずらん すみれ
そして
たいこ たぬき たまご だいこん
ちから ちりがみ ついで つくえ つばめ つみき
てがみ となり とんぼ ともだち
ながい にじいろ にんじん ぬりえ
ねがい ねむり のはら のうか
はがき はちみつ はなみ ばすけ
ひかり ひつじ ふじさん ふでばこ ふくろう
ぼうし まくら みかん みつばち
むぎ むらさき もみじ もくよう
やさい ゆうがた ゆうき ようび
りんご るすばん れんが ろうそく わかば
おかあさん おとうさん おにいさん おねえさん おじいさん おばあさん
こんにちは さようなら ありがとう おやすみ
ひこうき くだもの たべもの のみもの
えんぴつ ほうき ふぶき はなび ねぶくろ もうふ
たいよう さくらんぼ ようちえん ひまわり ようふく
ながぐつ つくし わかれる
ガラガラ→remove
あんぱん きんかん たんぽぽ
かんがる かんぱい こしょう こうえん こうばん こうちゃ
あんない うんどう がいこく がっき
じかん じどう しんぶん せかい たなか たいいく ちきゅう
てんき とけい にもつ ばあい へいわ ほんとう
まんが みらい もちもち やちん ゆうき れんしゅう
りょうり ろうじん わすれる
あさひ あした あひる
`;

const WORD_SET = new Set(
  WORDS_RAW.split(/\s+/).filter(w => w && !w.includes('→') && !w.includes('remove'))
);

// ── アプリ状態 ─────────────────────────────────────
const S = {
  screen: 'home',
  configMode: null,
  difficulty: 'std',
  // 通信
  peer: null, conn: null, roomCode: null, isHost: false,
  // ゲーム
  wall: [],
  myHand: [],          // 手牌 (順序が意味を持つ。並び替え可能)
  myDrawnIdx: null,    // ツモった牌の手牌内index (黄枠表示用)
  oppHandCount: 0,
  myDiscards: [], oppDiscards: [],
  myTurn: false,
  lastDiscard: null, pendingClaim: false,
  // あがり宣言 → 相手の判定待ち
  judging: null,       // {hand, words, type:'tsumo'|'ron', tile?} 相手から来た宣言
  awaitingJudge: false, // 自分が宣言して相手のOK/NGを待っている
  winner: null, winHand: null, winType: null, winWords: null,
  // ソロ
  solo: false, oppHand: [], aiTimer: null,
  // UI
  inputCode: '',
  selectedIdx: null,
};

// ── ユーティリティ ─────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const chars = () => CHAR_SETS[S.difficulty];

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

// ── 単語判定ロジック ──────────────────────────────
function isWord(s) { return WORD_SET.has(s); }

// 手牌が単語列に分割できるか (DP)
function canSplitIntoWords(tiles) {
  const n = tiles.length;
  if (n < 2) return false;
  const dp = new Array(n+1).fill(false);
  dp[0] = true;
  for (let i = 2; i <= n; i++) {
    for (let len = 2; len <= 5 && len <= i; len++) {
      const j = i - len;
      if (dp[j] && isWord(tiles.slice(j, i).join(''))) {
        dp[i] = true; break;
      }
    }
  }
  return dp[n];
}

// 単語分割を実際に求める (長い単語優先)
function findWordPartition(tiles) {
  const n = tiles.length;
  if (n < 2) return null;
  const dp = new Array(n+1).fill(null);
  dp[0] = { from: -1 };
  for (let i = 2; i <= n; i++) {
    for (let len = 5; len >= 2; len--) {
      if (len > i) continue;
      const j = i - len;
      if (dp[j] !== null) {
        const w = tiles.slice(j, i).join('');
        if (isWord(w)) {
          dp[i] = { from: j, word: w };
          break;
        }
      }
    }
  }
  if (dp[n] === null) return null;
  const partition = [];
  let i = n;
  while (i > 0) {
    partition.unshift({ start: dp[i].from, end: i, word: dp[i].word });
    i = dp[i].from;
  }
  return partition;
}

// ロン可能判定: 相手の捨て牌を任意位置に挿入して単語分割できるか
function canRonWith(concealed, tile) {
  for (let pos = 0; pos <= concealed.length; pos++) {
    const arr = [...concealed.slice(0, pos), tile, ...concealed.slice(pos)];
    if (canSplitIntoWords(arr)) return arr;
  }
  return null;
}

// テンパイ判定: 何を引けば上がれるか
function findWaits(concealed) {
  const waits = new Set();
  for (const t of chars()) {
    if (waits.has(t)) continue;
    if (canRonWith(concealed, t)) waits.add(t);
  }
  return [...waits];
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
    <div class="subtitle">ひらがなで単語を作る・2人対戦</div>
    <button class="btn primary" id="btn-create">ルーム作成</button>
    <button class="btn" id="btn-join">ルームに参加</button>
    <button class="btn ghost" id="btn-solo">🤖 1人で試す (AI対戦)</button>
    <div class="rule-card">
      <div class="rule-title">あそびかた</div>
      <ul>
        <li>手牌13枚 (ツモで14枚) を並び替えて<b>意味のある単語</b>を作る</li>
        <li>例: 「<b>あんこ</b>」+「<b>ねこ</b>」+「<b>いえ</b>」など</li>
        <li>準備できたら「<b>あがり宣言</b>」</li>
        <li>相手が「<b>OK</b>」or「<b>NG</b>」を判断 (会話で決めてOK)</li>
        <li><b>ツモ</b>: 自分のツモで宣言 / <b>ロン</b>: 相手の捨て牌で宣言</li>
        <li>辞書(${WORD_SET.size}語) は参考用 (色分けで表示)</li>
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
        <div class="diff-name">かんたん (子供向け)</div>
        <div class="diff-meta">基本46字×2=92枚 / 濁音なし</div>
      </button>
      <button class="diff-btn ${S.difficulty==='std'?'on':''}" data-diff="std">
        <div class="diff-name">ふつう</div>
        <div class="diff-meta">基本46+濁音20 ×2=132枚</div>
      </button>
      <button class="diff-btn ${S.difficulty==='full'?'on':''}" data-diff="full">
        <div class="diff-name">ほんかく</div>
        <div class="diff-meta">71字×2=142枚 (半濁音含む)</div>
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

// 手牌を単語ごとに色分けして表示
function renderHandWithWords(tiles, options={}) {
  const action = options.action ? options.action : '';
  const selected = options.selected;
  const drawnIdx = options.drawnIdx;
  // 単語分割を取得
  const partition = findWordPartition(tiles);
  // 各タイルがどの単語に属するか
  const wordOf = new Array(tiles.length).fill(null);
  if (partition) {
    partition.forEach((p, k) => {
      for (let i=p.start;i<p.end;i++) wordOf[i] = k;
    });
  }
  return tiles.map((t, i) => {
    let cls = 'tile';
    if (wordOf[i] !== null) {
      cls += ' word w' + (wordOf[i] % 4);
    } else {
      cls += ' nogroup';
    }
    if (selected === i) cls += ' selected';
    if (drawnIdx === i) cls += ' drawn';
    const data = action ? `data-idx="${i}" data-action="${action}"` : '';
    return `<div class="${cls}" ${data}>${esc(t)}</div>`;
  }).join('');
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

  // 単語分割の結果
  const partition = findWordPartition(S.myHand);
  const isWinning = partition !== null;

  // テンパイ判定 (7枚の時のみ意味あり)
  let tenpaiInfo = '';
  if (S.myTurn && !S.pendingClaim && S.myHand.length === HAND_SIZE) {
    const waits = findWaits(S.myHand);
    if (waits.length > 0) {
      const display = waits.length > 8 ? waits.slice(0,8).join('・')+'…' : waits.join('・');
      tenpaiInfo = `<div class="tenpai-badge">🔥 テンパイ! 待ち: ${display}</div>`;
    }
  }

  // 単語表示エリア (常時表示・現在の分割を見せる)
  let wordsHTML = '';
  if (partition) {
    wordsHTML = `<div class="words-detected">${partition.map(p =>
      `<span class="detected-word">${esc(p.word)}</span>`
    ).join('')}</div>`;
  } else if (S.myHand.length > 0) {
    wordsHTML = `<div class="words-detected"><span class="muted">単語未成立 (並び替えて作ろう)</span></div>`;
  }

  // ── 相手のあがり宣言を判定中 ──
  if (S.judging) {
    return renderJudging();
  }
  // ── 自分が宣言中で相手の判定待ち ──
  if (S.awaitingJudge) {
    return renderAwaitingJudge();
  }

  // ターン表示・操作ボタン (会話判断型: あがり判定はユーザー宣言で行う)
  let turnLabel, actionArea = '';
  if (S.pendingClaim) {
    const tile = S.lastDiscard;
    turnLabel = `相手が「${tile}」を捨てた`;
    actionArea = `<div class="action-row">
      <button class="big-btn win" id="btn-declare-ron">🏆 ロン宣言</button>
      <button class="big-btn skip" id="btn-skip">スキップ</button>
    </div>
    <div class="hint">この牌を使ってあがれるなら「ロン宣言」</div>`;
  } else if (S.myTurn) {
    const hasDrawn = S.myHand.length === HAND_SIZE + 1;
    if (S.selectedIdx != null) {
      const t = S.myHand[S.selectedIdx];
      turnLabel = `「${t}」を選択中`;
      actionArea = `<div class="action-row">
        ${hasDrawn ? `<button class="big-btn" id="btn-confirm-discard">捨てる</button>` : ''}
        <button class="btn xs" id="btn-move-left">← 左へ</button>
        <button class="btn xs" id="btn-move-right">→ 右へ</button>
        <button class="btn xs ghost" id="btn-cancel-select">キャンセル</button>
      </div>`;
    } else if (hasDrawn) {
      turnLabel = '14牌から単語を作って「あがり宣言」or 1枚捨てる';
      actionArea = `<div class="action-row">
        <button class="big-btn win" id="btn-declare-tsumo">🏆 あがり宣言</button>
        <div class="hint">牌タップ → 並び替え or 捨てる</div>
      </div>`;
    } else {
      turnLabel = 'あなたの番: ツモ or 並び替え';
      actionArea = `<div class="action-row">
        <button class="big-btn" id="btn-draw">ツモ</button>
        <button class="big-btn win" id="btn-declare-tsumo">🏆 あがり宣言</button>
      </div>
      <div class="hint">手牌をタップで並び替えできます</div>`;
    }
  } else {
    turnLabel = '相手の番...';
  }

  return `<div class="screen game">
    <div class="bar top">
      <div class="bar-side">山:${S.wall.length}</div>
      <div class="bar-mid ${S.myTurn||S.pendingClaim?'my-turn':''}">${turnLabel}</div>
      <div class="bar-side"><button class="btn xs ghost" id="btn-quit">終了</button></div>
    </div>

    <!-- 相手 -->
    <div class="opp-area">
      <div class="player-label">
        <span>相手</span>
        <span class="muted">手牌${S.oppHandCount}枚</span>
      </div>
      <div class="hand-row">
        <div class="concealed">${oppBacks}</div>
      </div>
      <div class="discards-zone">
        <div class="zone-label">相手の捨て牌</div>
        <div class="discards">${oppDis||'<span class="muted">なし</span>'}</div>
      </div>
    </div>

    <!-- 中央 -->
    <div class="center-zone">
      ${tenpaiInfo}
      ${actionArea}
    </div>

    <!-- 自分 -->
    <div class="me-area">
      <div class="discards-zone">
        <div class="zone-label">自分の捨て牌</div>
        <div class="discards">${myDis||'<span class="muted">なし</span>'}</div>
      </div>
      <div class="player-label">
        <span>自分 ${isWinning?'<span class="winning-badge">単語成立!</span>':''}</span>
        <span class="hand-tools">
          <button class="btn xs ghost" id="btn-sort">🔃 ソート</button>
          <span class="muted">${S.myHand.length}枚</span>
        </span>
      </div>
      ${wordsHTML}
      <div class="hand-row">
        <div class="concealed mine">${renderHandWithWords(S.myHand, {action:'select-hand', selected:S.selectedIdx, drawnIdx:S.myDrawnIdx})}</div>
      </div>
    </div>
  </div>`;
}

// ── あがり宣言を判定するUI (相手の宣言を見ている側) ──
function renderJudging() {
  const j = S.judging;
  const partition = findWordPartition(j.hand);
  const detectedWords = partition ? partition.map(p => p.word) : [];
  const handHTML = renderHandWithWords(j.hand);
  return `<div class="screen judging">
    <div class="title">⚖️ 相手のあがり宣言</div>
    <div class="sub-result">${j.type === 'ron' ? `ロン (${esc(j.tile)} で)` : 'ツモ'}</div>
    <div class="judging-card">
      <div class="zone-label">相手の手牌 (${j.hand.length}枚)</div>
      <div class="hand-row center"><div class="concealed">${handHTML}</div></div>
      ${detectedWords.length > 0
        ? `<div class="zone-label">辞書で検出された単語</div>
           <div class="words-detected">${detectedWords.map(w => `<span class="detected-word">${esc(w)}</span>`).join('')}</div>`
        : `<div class="muted">辞書には検出された単語なし (本当の単語があるか自分で確認)</div>`}
    </div>
    <div class="judge-prompt">この内容で「あがり」を認めますか?</div>
    <div class="action-row">
      <button class="big-btn win" id="btn-judge-ok">⭕ 認める (相手の勝ち)</button>
      <button class="big-btn skip" id="btn-judge-ng">❌ 認めない (続行)</button>
    </div>
    <div class="hint">話し合って決めてOK。辞書はあくまで参考。</div>
  </div>`;
}

// ── 自分が宣言して相手のOK/NG待ち ──
function renderAwaitingJudge() {
  return `<div class="screen waiting-judge">
    <div class="title">🏆 あがり宣言中</div>
    <div class="status">相手の判定を待っています...</div>
    <div class="muted">相手があなたの手牌を確認しています</div>
  </div>`;
}

function renderResult() {
  let msg, sub = '';
  if (S.winner === 'me')        { msg = '🎉 あなたの勝ち！'; sub = S.winType==='tsumo'?'ツモ':'ロン'; }
  else if (S.winner === 'opp')  { msg = '😢 相手の勝ち';     sub = S.winType==='tsumo'?'ツモ':'ロン'; }
  else                          { msg = '🤝 流局 (引き分け)'; }
  const wordsHTML = S.winWords
    ? `<div class="result-words">${S.winWords.map(w => `<span class="detected-word big">${esc(w)}</span>`).join('')}</div>`
    : '';
  const handDisp = S.winHand
    ? `<div class="hand-row center"><div class="concealed">${renderHandWithWords(S.winHand)}</div></div>`
    : '';
  return `<div class="screen result">
    <div class="title">${msg}</div>
    ${sub ? `<div class="sub-result">${sub}</div>` : ''}
    ${wordsHTML}
    ${handDisp}
    <button class="btn primary" id="btn-rematch">もう一回</button>
    <button class="btn" id="btn-home">ホームへ</button>
  </div>`;
}

// ── イベントバインド ───────────────────────────────
function bind() {
  $('btn-create')?.addEventListener('click', () => { S.configMode='create'; S.screen='config'; render(); });
  $('btn-join')?.addEventListener('click', () => { S.screen='join'; render(); });
  $('btn-solo')?.addEventListener('click', () => { S.configMode='solo'; S.screen='config'; render(); });
  document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', e => {
    S.difficulty = e.currentTarget.dataset.diff; render();
  }));
  $('btn-config-go')?.addEventListener('click', () => {
    if (S.configMode === 'solo') startSolo(); else startCreate();
  });
  $('btn-back')?.addEventListener('click', goHome);
  $('btn-quit')?.addEventListener('click', () => { if (confirm('対戦を終了しますか？')) goHome(); });
  $('btn-copy')?.addEventListener('click', () => navigator.clipboard?.writeText(S.roomCode).then(()=>alert('コピーしました')));
  $('code-input')?.addEventListener('input', e => { S.inputCode = e.target.value.toUpperCase(); e.target.value = S.inputCode; });
  $('btn-connect')?.addEventListener('click', startJoin);

  $('btn-draw')?.addEventListener('click', doDraw);
  $('btn-declare-tsumo')?.addEventListener('click', doDeclareTsumo);
  $('btn-declare-ron')?.addEventListener('click', doDeclareRon);
  $('btn-skip')?.addEventListener('click', doSkipClaim);
  $('btn-judge-ok')?.addEventListener('click', doJudgeOk);
  $('btn-judge-ng')?.addEventListener('click', doJudgeNg);
  document.querySelectorAll('[data-action="select-hand"]').forEach(el => {
    el.addEventListener('click', e => selectHand(Number(e.currentTarget.dataset.idx)));
  });
  $('btn-confirm-discard')?.addEventListener('click', confirmDiscard);
  $('btn-cancel-select')?.addEventListener('click', () => { S.selectedIdx = null; render(); });
  $('btn-move-left')?.addEventListener('click', () => moveSelected(-1));
  $('btn-move-right')?.addEventListener('click', () => moveSelected(+1));
  $('btn-sort')?.addEventListener('click', sortHand);
  $('btn-rematch')?.addEventListener('click', rematch);
  $('btn-home')?.addEventListener('click', goHome);
}

// ── 画面遷移 ───────────────────────────────────────
function goHome() {
  cleanupPeer();
  clearTimeout(S.aiTimer);
  S.aiTimer = null; S.solo = false; S.oppHand = [];
  S.screen = 'home'; S.roomCode = null; S.isHost = false;
  S.winner = null; S.winHand = null; S.winType = null; S.winWords = null;
  S.myHand = []; S.myDrawnIdx = null;
  S.myDiscards = []; S.oppDiscards = [];
  S.lastDiscard = null; S.pendingClaim = false;
  S.selectedIdx = null;
  render();
}

function cleanupPeer() {
  try { S.conn?.close(); } catch(_) {}
  try { S.peer?.destroy(); } catch(_) {}
  S.conn = null; S.peer = null;
}

// ── PeerJS ─────────────────────────────────────────
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

// ── ゲーム開始 ─────────────────────────────────────
function startGame() {
  S.wall = buildWall(S.difficulty);
  S.myHand = S.wall.splice(0, HAND_SIZE);
  const oppH = S.wall.splice(0, HAND_SIZE);
  S.oppHandCount = HAND_SIZE;
  S.myDiscards = []; S.oppDiscards = [];
  S.myDrawnIdx = null; S.lastDiscard = null; S.pendingClaim = false;
  S.winner = null; S.winHand = null; S.winType = null; S.winWords = null;
  S.selectedIdx = null;
  S.myTurn = true;
  S.screen = 'game';
  send({type:'init', oppHand: oppH, wall: S.wall, opponentTurn: false, difficulty: S.difficulty});
  render();
}

function onMessage(msg) {
  switch (msg.type) {
    case 'config':
      S.difficulty = msg.difficulty || S.difficulty;
      break;
    case 'init':
      S.difficulty = msg.difficulty || S.difficulty;
      S.myHand = msg.oppHand;
      S.oppHandCount = HAND_SIZE;
      S.wall = msg.wall || [];
      S.myDiscards = []; S.oppDiscards = [];
      S.myDrawnIdx = null; S.lastDiscard = null; S.pendingClaim = false;
      S.winner = null; S.winHand = null; S.winType = null; S.winWords = null;
      S.selectedIdx = null;
      S.myTurn = msg.opponentTurn;
      S.screen = 'game';
      render();
      break;
    case 'draw':
      S.wall = msg.wall || S.wall;
      S.oppHandCount = msg.oppHandCount;
      render();
      break;
    case 'discard':
      S.oppDiscards.push(msg.tile);
      S.oppHandCount = msg.oppHandCount;
      S.wall = msg.wall || S.wall;
      S.lastDiscard = msg.tile;
      // 会話判断型: 常にロン宣言の選択肢を出す (辞書チェックは行わない)
      S.pendingClaim = true;
      render();
      break;
    case 'skip':
      S.lastDiscard = null;
      S.myTurn = true;
      render();
      break;
    case 'declare_tsumo':
      // 相手がツモあがり宣言 → 自分が判定
      S.judging = {type:'tsumo', hand: msg.hand, words: msg.words || []};
      S.pendingClaim = false;
      render();
      break;
    case 'declare_ron':
      // 相手がロン宣言 → 自分が判定
      S.judging = {type:'ron', hand: msg.hand, words: msg.words || [], tile: msg.tile};
      S.pendingClaim = false;
      render();
      break;
    case 'judge_ok':
      // 相手が自分のあがり宣言を認めた → 自分の勝ち
      S.awaitingJudge = false;
      S.winner = 'me';
      // winType / winHand / winWords は宣言した時点の手牌で確定
      S.winType = S.lastDeclareType || 'tsumo';
      S.winHand = S.lastDeclareHand || [...S.myHand];
      S.winWords = S.lastDeclareWords || [];
      S.screen = 'result';
      render();
      break;
    case 'judge_ng':
      // 相手が認めなかった → 続行
      S.awaitingJudge = false;
      alert('相手はあなたのあがりを認めませんでした。続行します。');
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

function send(msg) { try { S.conn?.send(msg); } catch(e) {} }

// ── 操作: ツモ・捨てる・選択 ───────────────────────
function doDraw() {
  if (!S.myTurn || S.pendingClaim) return;
  if (S.myHand.length >= HAND_SIZE + 1) return; // 既にツモ済み
  if (S.wall.length === 0) {
    if (!S.solo) send({type:'draw_game'});
    S.winner = 'draw'; S.screen = 'result'; render(); return;
  }
  const t = S.wall.shift();
  S.myHand.push(t);
  S.myDrawnIdx = S.myHand.length - 1;
  if (!S.solo) send({type:'draw', wall:S.wall, oppHandCount:S.oppHandCount});
  render();
}

function selectHand(idx) {
  if (!S.myTurn) return;
  // 7枚時も並び替えのために選択可。ただし7枚時は「捨てる」ボタンは出さない (discard可能なのは8枚時のみ)
  S.selectedIdx = (S.selectedIdx === idx) ? null : idx;
  render();
}

function confirmDiscard() {
  if (!S.myTurn || S.selectedIdx == null) return;
  if (S.myHand.length !== HAND_SIZE + 1) { alert('まずツモしてください'); return; }
  const idx = S.selectedIdx;
  const tile = S.myHand[idx];
  S.myHand.splice(idx, 1);
  S.myDrawnIdx = null;
  S.selectedIdx = null;
  S.myDiscards.push(tile);
  S.myTurn = false;
  if (!S.solo) send({type:'discard', tile, wall:S.wall, oppHandCount:S.oppHandCount});
  render();
  scheduleAi();
}

function moveSelected(dir) {
  if (S.selectedIdx == null) return;
  const i = S.selectedIdx;
  const j = i + dir;
  if (j < 0 || j >= S.myHand.length) return;
  [S.myHand[i], S.myHand[j]] = [S.myHand[j], S.myHand[i]];
  if (S.myDrawnIdx === i) S.myDrawnIdx = j;
  else if (S.myDrawnIdx === j) S.myDrawnIdx = i;
  S.selectedIdx = j;
  render();
}

function sortHand() {
  const cs = ALL_CHARS;
  S.myHand = [...S.myHand].sort((a,b) => cs.indexOf(a) - cs.indexOf(b));
  S.myDrawnIdx = null;
  S.selectedIdx = null;
  render();
}

// ── あがり宣言: ツモあがり (相手の判定待ち) ───────
function doDeclareTsumo() {
  if (!S.myTurn) return;
  const partition = findWordPartition(S.myHand);
  const words = partition ? partition.map(p => p.word) : [];
  const hand = [...S.myHand];
  S.awaitingJudge = true;
  S.selectedIdx = null;
  S.lastDeclareType = 'tsumo';
  S.lastDeclareHand = hand;
  S.lastDeclareWords = words;
  if (S.solo) {
    setTimeout(() => aiJudge({type:'tsumo', hand, words}), 600);
  } else {
    send({type:'declare_tsumo', hand, words});
  }
  render();
}

// ── ロン宣言 ──
function doDeclareRon() {
  if (!S.pendingClaim || S.lastDiscard == null) return;
  const tile = S.lastDiscard;
  const hand = [...S.myHand, tile];
  const partition = findWordPartition(hand);
  const words = partition ? partition.map(p => p.word) : [];
  S.awaitingJudge = true;
  S.selectedIdx = null;
  S.pendingClaim = false;
  S.lastDeclareType = 'ron';
  S.lastDeclareHand = hand;
  S.lastDeclareWords = words;
  if (S.solo) {
    setTimeout(() => aiJudge({type:'ron', hand, words, tile}), 600);
  } else {
    send({type:'declare_ron', hand, words, tile});
  }
  render();
}

// ── ソロ用: AIが判定 ──
function aiJudge(decl) {
  // AI判定: 辞書で単語成立してるか?
  const ok = canSplitIntoWords(decl.hand);
  S.awaitingJudge = false;
  if (ok) {
    // 認める → 自分の勝ち
    S.winner = 'me';
    S.winType = decl.type;
    S.winHand = decl.hand;
    S.winWords = decl.words;
    S.screen = 'result';
  } else {
    alert(`AI: 「単語が成立していません」と認められませんでした。続行します。`);
  }
  render();
}

// ── 判定OK (相手のあがりを認める) ──
function doJudgeOk() {
  if (!S.judging) return;
  const j = S.judging;
  S.judging = null;
  // 相手の勝ち
  S.winner = 'opp'; S.winType = j.type;
  S.winHand = j.hand; S.winWords = j.words;
  S.screen = 'result';
  if (!S.solo) send({type:'judge_ok'});
  render();
}

// ── 判定NG (相手のあがりを認めない) ──
function doJudgeNg() {
  if (!S.judging) return;
  S.judging = null;
  // ゲーム続行 (相手の番に戻す)
  S.myTurn = false;
  if (!S.solo) send({type:'judge_ng'});
  render();
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
  S.myHand = S.wall.splice(0, HAND_SIZE);
  S.oppHand = S.wall.splice(0, HAND_SIZE);
  S.oppHandCount = HAND_SIZE;
  S.myDiscards = []; S.oppDiscards = [];
  S.myDrawnIdx = null; S.lastDiscard = null; S.pendingClaim = false;
  S.winner = null; S.winHand = null; S.winType = null; S.winWords = null;
  S.selectedIdx = null;
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
  // AIロン判定 (直前に自分が捨てた牌で)
  const myLastDis = S.myDiscards[S.myDiscards.length-1];
  if (myLastDis) {
    const ronArr = canRonWith(S.oppHand, myLastDis);
    if (ronArr) {
      const part = findWordPartition(ronArr);
      S.winner = 'opp'; S.winType = 'ron';
      S.winHand = ronArr; S.winWords = part.map(p => p.word);
      S.screen = 'result'; render(); return;
    }
  }
  // AIツモ
  if (S.wall.length === 0) {
    S.winner = 'draw'; S.screen = 'result'; render(); return;
  }
  const t = S.wall.shift();
  S.oppHand.push(t);
  // 単語分割可能か (任意順序を試す: 簡易的に末尾追加で判定→ダメなら全置換試行は重いので省略)
  // → 現arrangementと、ソート版で試す
  let winArr = canSplitIntoWords(S.oppHand) ? S.oppHand
             : canSplitIntoWords([...S.oppHand].sort((a,b)=>ALL_CHARS.indexOf(a)-ALL_CHARS.indexOf(b))) ? [...S.oppHand].sort((a,b)=>ALL_CHARS.indexOf(a)-ALL_CHARS.indexOf(b))
             : null;
  if (winArr) {
    const part = findWordPartition(winArr);
    S.winner = 'opp'; S.winType = 'tsumo';
    S.winHand = winArr; S.winWords = part.map(p => p.word);
    S.screen = 'result'; render(); return;
  }
  aiDiscard();
}

function aiDiscard() {
  // シンプルAI: 単語に貢献していない牌(孤立)を優先で捨てる
  const part = findWordPartition(S.oppHand);
  let candidates = [];
  if (part) {
    // 既に単語化されているなら、最も短い単語の最初の文字を捨てる(改善余地あり)
    const inWord = new Array(S.oppHand.length).fill(false);
    part.forEach(p => { for (let i=p.start;i<p.end;i++) inWord[i] = true; });
    candidates = S.oppHand.map((t,i) => ({t,i,inWord:inWord[i]})).filter(x => !x.inWord);
  }
  if (candidates.length === 0) candidates = S.oppHand.map((t,i) => ({t,i}));
  const pick = candidates[Math.floor(Math.random()*candidates.length)];
  const tile = pick.t;
  S.oppHand.splice(pick.i, 1);
  S.oppDiscards.push(tile);
  S.oppHandCount = S.oppHand.length;
  S.lastDiscard = tile;
  // 会話判断型: 常にロン宣言の選択肢を出す
  S.pendingClaim = true;
  S.myTurn = false;
  render();
}

function rematch() {
  if (S.solo) { startSolo(); return; }
  if (!S.conn) { goHome(); return; }
  send({type:'rematch_request'});
  alert('相手の同意を待っています...');
}

window.addEventListener('DOMContentLoaded', render);
