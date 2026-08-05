// -------------------------------------------------------------
// APP CONFIG & STATE
// -------------------------------------------------------------
let STATE = {
  clientId: localStorage.getItem('clientId') || '',
  accessToken: localStorage.getItem('accessToken') || '',
  tokenExpiry: parseInt(localStorage.getItem('tokenExpiry') || '0', 10),
  folderId: localStorage.getItem('folderId') || '',
  metadataFileId: localStorage.getItem('metadataFileId') || '',
  cards: [],          // すべての名刺データ
  filteredCards: [],  // 検索・フィルター後の名刺データ
  selectedTag: 'all', // 現在選択されているフィルタータグ
  addedTags: [],      // 新規登録フォームで一時追加中のタグリスト
  editingCardId: null, // 編集中の名刺ID（null = 新規登録モード）
  kassenMode: 'tag',  // 合戦モードのチーム分け基準（'tag' or 'initial'）
  tokenClient: null,  // Google OAuth Token Client
  imageCache: {},     // { fileId: blobUrl }
  user: null          // { name, email, avatarUrl }
};

// Google API endpoint constants
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// -------------------------------------------------------------
// DOM ELEMENTS
// -------------------------------------------------------------
const elements = {
  app: document.getElementById('app'),
  // Screens
  screenAuth: document.getElementById('screen-auth'),
  screenMain: document.getElementById('screen-main'),
  screenAdd: document.getElementById('screen-add'),
  screenSettings: document.getElementById('screen-settings'),
  // Auth Screen
  btnLogin: document.getElementById('btn-login'),
  btnOpenSetup: document.getElementById('btn-open-setup'),
  // Main Screen
  btnSync: document.getElementById('btn-sync'),
  btnAddCard: document.getElementById('btn-add-card'),
  btnSettings: document.getElementById('btn-settings'),
  searchInput: document.getElementById('search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  tagFilters: document.getElementById('tag-filters'),
  cardDeck: document.getElementById('card-deck'),
  cardIndicator: document.getElementById('card-indicator'),
  cardCounter: document.getElementById('card-counter'),
  btnPrevCard: document.getElementById('btn-prev-card'),
  btnNextCard: document.getElementById('btn-next-card'),
  btnEmptyAdd: document.getElementById('btn-empty-add'),
  // Add Screen
  formAddCard: document.getElementById('form-add-card'),
  photoPreviewWrapper: document.getElementById('photo-preview-wrapper'),
  photoPreview: document.getElementById('photo-preview'),
  photoPlaceholder: document.getElementById('photo-placeholder'),
  inputFile: document.getElementById('input-file'),
  btnCapture: document.getElementById('btn-capture'),
  btnGallery: document.getElementById('btn-gallery'),
  inputName: document.getElementById('input-name'),
  inputAlphabet: document.getElementById('input-alphabet'),
  inputMemo: document.getElementById('input-memo'),
  inputTag: document.getElementById('input-tag'),
  btnAddTag: document.getElementById('btn-add-tag'),
  addedTagsList: document.getElementById('added-tags-list'),
  existingTagsSection: document.getElementById('existing-tags-section'),
  existingTagsList: document.getElementById('existing-tags-list'),
  btnCancelAdd: document.getElementById('btn-cancel-add'),
  btnSubmitCard: document.getElementById('btn-submit-card'),
  btnSubmitText: document.getElementById('btn-submit-text'),
  addScreenTitle: document.getElementById('add-screen-title'),
  // Settings Screen
  inputClientId: document.getElementById('input-client-id'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  userName: document.getElementById('user-name'),
  userEmail: document.getElementById('user-email'),
  userAvatar: document.getElementById('user-avatar'),
  btnLogout: document.getElementById('btn-logout'),
  // Kassen Mode Screen（合戦モード）
  btnKassen: document.getElementById('btn-kassen'),
  btnCloseKassen: document.getElementById('btn-close-kassen'),
  kassenModeSwitch: document.getElementById('kassen-mode-switch'),
  kassenMap: document.getElementById('kassen-map'),
  kassenMapWrapper: document.querySelector('.kassen-map-wrapper'),
  kassenEmptyState: document.getElementById('kassen-empty-state'),
  kassenHexPopup: document.getElementById('kassen-hex-popup'),
  kassenLegend: document.getElementById('kassen-legend'),
  btnStartKassen: document.getElementById('btn-start-kassen'),
  kassenCommentary: document.getElementById('kassen-commentary'),
  kassenCommentaryText: document.getElementById('kassen-commentary-text'),
  btnSkipKassen: document.getElementById('btn-skip-kassen'),
  kassenResult: document.getElementById('kassen-result'),
  // Common UI
  loadingOverlay: document.getElementById('loading-overlay'),
  loadingText: document.getElementById('loading-text'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message')
};

// -------------------------------------------------------------
// APP INITIALIZATION
// -------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // SVGアイコンをLucideでレンダリング
  lucide.createIcons();

  // イベントリスナーの登録
  registerEventListeners();

  // 設定画面に保存済みのクライアントIDをセット
  if (STATE.clientId) {
    elements.inputClientId.value = STATE.clientId;
    initGoogleAuth();
  }

  // セッション有効性のチェック
  checkSession();
}

function checkSession() {
  const now = Date.now();
  if (STATE.accessToken && STATE.tokenExpiry > now) {
    // セッション有効
    showScreen('screen-main');
    syncWithDrive();
  } else {
    // サインインが必要
    showScreen('screen-auth');
  }
}

// -------------------------------------------------------------
// NAVIGATION & SCREEN SWITCHING
// -------------------------------------------------------------
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  const activeScreen = document.getElementById(screenId);
  if (activeScreen) {
    activeScreen.classList.add('active');
  }
  // Lucideアイコンの再読み込み
  lucide.createIcons();
}

// -------------------------------------------------------------
// TOAST & LOADING OVERLAYS
// -------------------------------------------------------------
function showLoading(text = '読み込み中...') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  elements.loadingOverlay.classList.add('hidden');
}

function showToast(message, duration = 3000) {
  elements.toastMessage.textContent = message;
  elements.toast.classList.add('active');
  elements.toast.classList.remove('hidden');

  setTimeout(() => {
    elements.toast.classList.remove('active');
    setTimeout(() => {
      elements.toast.classList.add('hidden');
    }, 300);
  }, duration);
}

// -------------------------------------------------------------
// GOOGLE OAUTH 2.0 (AUTHENTICATION)
// -------------------------------------------------------------
function initGoogleAuth() {
  if (!STATE.clientId) return;

  try {
    // GSIクライアントの初期化
    STATE.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: STATE.clientId,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          hideLoading();
          showToast(`認証エラー: ${tokenResponse.error}`);
          return;
        }
        
        STATE.accessToken = tokenResponse.access_token;
        STATE.tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
        
        localStorage.setItem('accessToken', STATE.accessToken);
        localStorage.setItem('tokenExpiry', STATE.tokenExpiry.toString());

        showToast('Google認証に成功しました。');
        fetchUserProfile();
        showScreen('screen-main');
        syncWithDrive();
      },
    });
  } catch (error) {
    console.error('Google Auth Init Error:', error);
    showToast('Google API ライブラリの初期化に失敗しました。時間をおいて再度お試しください。');
  }
}

function handleLogin() {
  if (!STATE.clientId) {
    showToast('はじめに「初期設定」からOAuthクライアントIDを登録してください。');
    showScreen('screen-settings');
    return;
  }

  showLoading('Googleでサインイン中...');
  if (!STATE.tokenClient) {
    initGoogleAuth();
  }

  if (STATE.tokenClient) {
    // 期限切れか新規の場合のみ認証要求、すでに持っていればスキップ可能
    STATE.tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    hideLoading();
    showToast('認証クライアントの初期化に失敗しました。クライアントIDが正しいか確認してください。');
  }
}

function logout() {
  STATE.accessToken = '';
  STATE.tokenExpiry = 0;
  STATE.cards = [];
  STATE.filteredCards = [];
  STATE.imageCache = {};
  localStorage.removeItem('accessToken');
  localStorage.removeItem('tokenExpiry');
  localStorage.removeItem('folderId');
  localStorage.removeItem('metadataFileId');
  
  showToast('ログアウトしました');
  showScreen('screen-auth');
}

async function fetchUserProfile() {
  if (!STATE.accessToken) return;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${STATE.accessToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      STATE.user = data;
      elements.userName.textContent = data.name || 'ユーザー名なし';
      elements.userEmail.textContent = data.email || '';
      if (data.picture) {
        elements.userAvatar.innerHTML = `<img src="${data.picture}" alt="avatar" style="width:100%; height:100%; border-radius:50%;">`;
      }
    }
  } catch (e) {
    console.error('Failed to fetch user profile:', e);
  }
}

// -------------------------------------------------------------
// GOOGLE DRIVE API OPERATIONS
// -------------------------------------------------------------
async function driveFetch(url, options = {}) {
  // トークンの有効期限チェック
  if (Date.now() >= STATE.tokenExpiry) {
    showToast('セッションの期限が切れました。再サインインしてください。');
    logout();
    throw new Error('Token expired');
  }

  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${STATE.accessToken}`;

  const response = await fetch(url, options);

  if (response.status === 401) {
    showToast('認証エラーが発生しました。再ログインしてください。');
    logout();
    throw new Error('Unauthorized');
  }

  return response;
}

// ドライブのアプリフォルダとメタデータの同期
async function syncWithDrive() {
  showLoading('Googleドライブと同期中...');
  try {
    // ユーザー情報の取得（未取得の場合）
    if (!STATE.user) {
      await fetchUserProfile();
    }

    // 1. フォルダの存在確認・作成
    if (!STATE.folderId) {
      STATE.folderId = await getOrCreateAppFolder();
      localStorage.setItem('folderId', STATE.folderId);
    }

    // 2. metadata.jsonの存在確認・作成・取得
    if (!STATE.metadataFileId) {
      STATE.metadataFileId = await getOrCreateMetadataFileId();
      localStorage.setItem('metadataFileId', STATE.metadataFileId);
    }

    // 3. メタデータファイルのダウンロード
    await loadMetadata();
    
    hideLoading();
    showToast('同期が完了しました');
    renderApp();
  } catch (error) {
    console.error('Sync Error:', error);
    hideLoading();
    showToast('同期中にエラーが発生しました');
  }
}

// アプリ専用フォルダの検索または作成
async function getOrCreateAppFolder() {
  const query = encodeURIComponent("name = 'BusinessCardManagerApp' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const res = await driveFetch(`${DRIVE_API_BASE}/files?q=${query}&fields=files(id)`);
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  // 存在しないので新規作成
  const folderMetadata = {
    name: 'BusinessCardManagerApp',
    mimeType: 'application/vnd.google-apps.folder'
  };

  const createRes = await driveFetch(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(folderMetadata)
  });

  const createdFolder = await createRes.json();
  return createdFolder.id;
}

// metadata.json の検索または作成
async function getOrCreateMetadataFileId() {
  const query = encodeURIComponent(`name = 'metadata.json' and '${STATE.folderId}' in parents and trashed = false`);
  const res = await driveFetch(`${DRIVE_API_BASE}/files?q=${query}&fields=files(id)`);
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  // 存在しないので、空の配列 [] を書き込んで新規作成
  const fileMetadata = {
    name: 'metadata.json',
    parents: [STATE.folderId],
    mimeType: 'application/json'
  };

  const boundary = 'foo_bar_baz';
  const metadataPart = JSON.stringify(fileMetadata);
  const mediaPart = JSON.stringify([]); // 空の名刺リスト

  const multipartBody = 
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadataPart}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${mediaPart}\r\n` +
    `--${boundary}--`;

  const createRes = await driveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });

  const createdFile = await createRes.json();
  return createdFile.id;
}

// metadata.json をダウンロードして読み込み
async function loadMetadata() {
  const res = await driveFetch(`${DRIVE_API_BASE}/files/${STATE.metadataFileId}?alt=media`);
  if (res.ok) {
    STATE.cards = await res.json();
  } else {
    throw new Error('Failed to load metadata');
  }
}

// metadata.json をドライブに保存
async function saveMetadata() {
  const res = await driveFetch(`${DRIVE_UPLOAD_BASE}/files/${STATE.metadataFileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(STATE.cards)
  });
  return res.ok;
}

// 名刺画像のアップロード
async function uploadImageToDrive(fileBlob, filename) {
  const fileMetadata = {
    name: filename,
    parents: [STATE.folderId],
    mimeType: fileBlob.type
  };

  const boundary = 'image_upload_boundary';
  const metadataPart = JSON.stringify(fileMetadata);
  
  // ArrayBufferに変換してマルチパート送信
  const arrayBuffer = await fileBlob.arrayBuffer();
  const mediaBytes = new Uint8Array(arrayBuffer);

  const header = 
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadataPart}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${fileBlob.type}\r\n\r\n`;

  const footer = `\r\n--${boundary}--`;
  
  // バッファの結合
  const headerBytes = new TextEncoder().encode(header);
  const footerBytes = new TextEncoder().encode(footer);
  
  const totalLength = headerBytes.length + mediaBytes.length + footerBytes.length;
  const multipartBodyBytes = new Uint8Array(totalLength);
  
  multipartBodyBytes.set(headerBytes, 0);
  multipartBodyBytes.set(mediaBytes, headerBytes.length);
  multipartBodyBytes.set(footerBytes, headerBytes.length + mediaBytes.length);

  const uploadRes = await driveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBodyBytes
  });

  if (!uploadRes.ok) {
    throw new Error('Image upload failed');
  }

  const fileData = await uploadRes.json();
  return fileData.id; // Google DriveのファイルID
}

// ドライブから画像Blobを安全にフェッチしてキャッシュする
async function fetchCardImage(fileId) {
  if (STATE.imageCache[fileId]) {
    return STATE.imageCache[fileId];
  }

  try {
    const res = await driveFetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`);
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      STATE.imageCache[fileId] = blobUrl;
      return blobUrl;
    }
  } catch (error) {
    console.error('Image fetch error:', error);
  }
  return ''; // 失敗時は空文字
}

// -------------------------------------------------------------
// BUSINESS CARD CARD VIEWER (SWIPE CAROUSEL)
// -------------------------------------------------------------
let currentSwipeIndex = 0;

function renderApp() {
  filterCards();
  renderFilters();
  renderCards();
}

function filterCards() {
  const query = elements.searchInput.value.toLowerCase().trim();
  
  STATE.filteredCards = STATE.cards.filter(card => {
    // アルファベット・氏名検索
    const matchQuery = !query || 
      (card.name && card.name.toLowerCase().includes(query)) ||
      (card.alphabet && card.alphabet.toLowerCase().includes(query));
      
    // タグフィルター
    const matchTag = STATE.selectedTag === 'all' || 
      (card.tags && card.tags.includes(STATE.selectedTag));

    return matchQuery && matchTag;
  });

  // 日付の降順にソート（新しい順）
  STATE.filteredCards.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  currentSwipeIndex = 0; // 検索時は先頭へ戻す
}

function renderFilters() {
  // すべてのタグを抽出
  const allTagsSet = new Set();
  STATE.cards.forEach(card => {
    if (card.tags) card.tags.forEach(tag => allTagsSet.add(tag));
  });

  // 既存のフィルター要素をクリア（「すべて」以外）
  elements.tagFilters.innerHTML = '';
  
  // 「すべて」を追加
  const allBtn = document.createElement('button');
  allBtn.className = `tag-filter-item ${STATE.selectedTag === 'all' ? 'active' : ''}`;
  allBtn.dataset.tag = 'all';
  allBtn.textContent = 'すべて';
  elements.tagFilters.appendChild(allBtn);

  // タグごとのフィルターを追加
  allTagsSet.forEach(tag => {
    const tagBtn = document.createElement('button');
    tagBtn.className = `tag-filter-item ${STATE.selectedTag === tag ? 'active' : ''}`;
    tagBtn.dataset.tag = tag;
    tagBtn.textContent = tag;
    elements.tagFilters.appendChild(tagBtn);
  });
}

function renderCards() {
  const container = elements.cardDeck;
  container.innerHTML = '';

  if (STATE.filteredCards.length === 0) {
    // 空ステートを表示
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <i data-lucide="inbox" style="width:48px; height:48px; color:var(--text-muted); margin-bottom:12px;"></i>
      <p style="margin-bottom:16px;">該当する名刺が見つかりません</p>
      <button id="btn-empty-add-action" class="btn btn-primary">
        <i data-lucide="plus"></i>
        <span>新規名刺を登録する</span>
      </button>
    `;
    container.appendChild(emptyState);
    elements.cardIndicator.classList.add('hidden');
    
    // イベント割り当て
    const emptyAddBtn = document.getElementById('btn-empty-add-action');
    if (emptyAddBtn) {
      emptyAddBtn.addEventListener('click', () => {
        resetAddForm();
        showScreen('screen-add');
      });
    }
    lucide.createIcons();
    return;
  }

  elements.cardIndicator.classList.remove('hidden');
  updateIndicator();

  // カード要素を動的に生成して挿入
  STATE.filteredCards.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'business-card';
    cardEl.dataset.index = index;

    // 初期状態はローディング風プレースホルダー
    cardEl.innerHTML = `
      <div class="card-bg-blur" id="bg-blur-${index}"></div>
      <div class="card-image-wrapper">
        <div class="spinner" style="width:30px; height:30px; border-width:2px; border-top-color:var(--accent-indigo)"></div>
        <img class="card-image hidden" id="card-img-${index}" alt="${card.name}">
      </div>
      <div class="card-info">
        <div class="name-row">
          <div>
            <h3>${escapeHTML(card.name)}</h3>
            <div class="alphabet">${escapeHTML(card.alphabet)}</div>
          </div>
          <div class="card-actions">
            <button class="btn-icon btn-edit-card" data-id="${card.id}" style="border:none; background:transparent; color:var(--text-muted);" title="編集">
              <i data-lucide="pencil" style="width:18px; height:18px;"></i>
            </button>
            <button class="btn-icon btn-delete-card" data-id="${card.id}" style="border:none; background:transparent; color:var(--text-muted);" title="削除">
              <i data-lucide="trash-2" style="width:18px; height:18px;"></i>
            </button>
          </div>
        </div>
        <div class="card-tags">
          ${card.tags ? card.tags.map(t => `<span class="card-tag">${escapeHTML(t)}</span>`).join('') : ''}
        </div>
        ${card.memo ? `<p class="card-memo">${escapeHTML(card.memo)}</p>` : ''}
      </div>
    `;

    container.appendChild(cardEl);
  });

  // 編集アイコンのイベント
  document.querySelectorAll('.btn-edit-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditCard(btn.dataset.id);
    });
  });

  // ゴミ箱アイコンのイベント
  document.querySelectorAll('.btn-delete-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('この名刺を削除してもよろしいですか？（Googleドライブ内の画像ファイルも削除されます）')) {
        deleteCard(id);
      }
    });
  });

  lucide.createIcons();
  
  // スワイプ（スクロールスナップ）の同期
  scrollToCard(currentSwipeIndex, false);
  loadVisibleImages();
}

function updateIndicator() {
  elements.cardCounter.textContent = `${currentSwipeIndex + 1} / ${STATE.filteredCards.length}`;
}

// 指定したインデックスのカードにスクロール移動
function scrollToCard(index, smooth = true) {
  const cards = elements.cardDeck.querySelectorAll('.business-card');
  if (cards.length > 0 && cards[index]) {
    const deckWidth = elements.cardDeck.clientWidth;
    // スクロールスナップ位置へスクロール
    elements.cardDeck.scrollTo({
      left: index * (deckWidth + 20), // 20はgap
      behavior: smooth ? 'smooth' : 'auto'
    });
    currentSwipeIndex = index;
    updateIndicator();
  }
}

// カルーセルのスクロールイベント監視（スワイプ完了時のハンドラ）
let scrollTimeout;
elements.cardDeck.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const deckWidth = elements.cardDeck.clientWidth + 20; // gap分を含む
    const scrollLeft = elements.cardDeck.scrollLeft;
    const newIndex = Math.round(scrollLeft / deckWidth);
    
    if (newIndex !== currentSwipeIndex && newIndex >= 0 && newIndex < STATE.filteredCards.length) {
      currentSwipeIndex = newIndex;
      updateIndicator();
      loadVisibleImages();
    }
  }, 100); // デバウンス
});

// 現在表示されているカードと、その前後の画像を遅延読み込み
async function loadVisibleImages() {
  const indicesToLoad = [currentSwipeIndex, currentSwipeIndex - 1, currentSwipeIndex + 1];
  
  indicesToLoad.forEach(async (index) => {
    if (index < 0 || index >= STATE.filteredCards.length) return;
    const card = STATE.filteredCards[index];
    
    const imgEl = document.getElementById(`card-img-${index}`);
    const blurEl = document.getElementById(`bg-blur-${index}`);
    
    // すでに読み込み完了している場合はスキップ
    if (!imgEl || imgEl.src) return;

    try {
      const imageUrl = await fetchCardImage(card.imageId);
      if (imageUrl) {
        imgEl.src = imageUrl;
        imgEl.classList.remove('hidden');
        // ローディングスピナーを非表示にするため、ラッパーの子要素のスピナーを削除
        const spinner = imgEl.parentElement.querySelector('.spinner');
        if (spinner) spinner.remove();

        // ぼかし背景をセット
        blurEl.style.backgroundImage = `url(${imageUrl})`;
      }
    } catch (e) {
      console.error('Failed to load card image for index ' + index, e);
    }
  });
}

// 名刺削除処理
async function deleteCard(cardId) {
  showLoading('名刺を削除中...');
  try {
    const cardIndex = STATE.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = STATE.cards[cardIndex];

    // 1. Googleドライブから画像ファイルを削除
    if (card.imageId) {
      await driveFetch(`${DRIVE_API_BASE}/files/${card.imageId}`, {
        method: 'DELETE'
      });
      // キャッシュからも削除
      if (STATE.imageCache[card.imageId]) {
        URL.revokeObjectURL(STATE.imageCache[card.imageId]);
        delete STATE.imageCache[card.imageId];
      }
    }

    // 2. メタデータ配列から削除して保存
    STATE.cards.splice(cardIndex, 1);
    await saveMetadata();
    
    hideLoading();
    showToast('名刺を削除しました');
    renderApp();
  } catch (error) {
    console.error('Delete Card Error:', error);
    hideLoading();
    showToast('削除中にエラーが発生しました');
  }
}

// 名刺編集画面を開く（既存データをフォームに反映）
async function openEditCard(cardId) {
  const card = STATE.cards.find(c => c.id === cardId);
  if (!card) return;

  resetAddForm();
  STATE.editingCardId = cardId;

  elements.addScreenTitle.textContent = '名刺を編集';
  elements.btnSubmitText.textContent = '変更を保存';

  elements.inputName.value = card.name || '';
  elements.inputAlphabet.value = card.alphabet || '';
  elements.inputMemo.value = card.memo || '';
  STATE.addedTags = card.tags ? [...card.tags] : [];
  renderAddedTags();

  if (card.imageId) {
    showLoading('画像を読み込み中...');
    const imageUrl = await fetchCardImage(card.imageId);
    hideLoading();
    if (imageUrl) {
      elements.photoPreview.src = imageUrl;
      elements.photoPreview.classList.remove('hidden');
      elements.photoPlaceholder.classList.add('hidden');
    }
  }

  showScreen('screen-add');
}

// -------------------------------------------------------------
// NEW CARD REGISTRATION (新規登録)
// -------------------------------------------------------------
function registerEventListeners() {
  // サインイン画面
  elements.btnLogin.addEventListener('click', handleLogin);
  elements.btnOpenSetup.addEventListener('click', () => {
    elements.inputClientId.value = STATE.clientId;
    showScreen('screen-settings');
  });

  // メイン画面ヘッダー
  elements.btnSync.addEventListener('click', syncWithDrive);
  elements.btnSettings.addEventListener('click', () => showScreen('screen-settings'));
  elements.btnAddCard.addEventListener('click', () => {
    resetAddForm();
    showScreen('screen-add');
  });

  // 検索・クリア
  elements.searchInput.addEventListener('input', () => {
    if (elements.searchInput.value.length > 0) {
      elements.btnClearSearch.classList.remove('hidden');
    } else {
      elements.btnClearSearch.classList.add('hidden');
    }
    renderApp();
  });
  
  elements.btnClearSearch.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.btnClearSearch.classList.add('hidden');
    renderApp();
  });

  // タグフィルターの選択
  elements.tagFilters.addEventListener('click', (e) => {
    const item = e.target.closest('.tag-filter-item');
    if (!item) return;
    
    STATE.selectedTag = item.dataset.tag;
    document.querySelectorAll('.tag-filter-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    
    renderApp();
  });

  // カルーセルナビゲーションボタン（左右クリック）
  elements.btnPrevCard.addEventListener('click', () => {
    if (currentSwipeIndex > 0) {
      scrollToCard(currentSwipeIndex - 1);
    }
  });

  elements.btnNextCard.addEventListener('click', () => {
    if (currentSwipeIndex < STATE.filteredCards.length - 1) {
      scrollToCard(currentSwipeIndex + 1);
    }
  });

  // 新規登録：キャンセル
  elements.btnCancelAdd.addEventListener('click', () => {
    resetAddForm();
    showScreen('screen-main');
  });

  // 新規登録：写真撮影・選択トリガー
  elements.photoPreviewWrapper.addEventListener('click', () => elements.inputFile.click());
  elements.btnCapture.addEventListener('click', () => {
    elements.inputFile.removeAttribute('capture');
    elements.inputFile.setAttribute('capture', 'environment'); // アウトカメラ優先
    elements.inputFile.click();
  });
  elements.btnGallery.addEventListener('click', () => {
    elements.inputFile.removeAttribute('capture'); // アルバム選択
    elements.inputFile.click();
  });

  // ファイル選択完了イベント
  elements.inputFile.addEventListener('change', handleFileSelect);

  // 新規登録：タグの追加
  elements.btnAddTag.addEventListener('click', addTagFromInput);
  elements.inputTag.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });

  // 新規登録：追加済みタグの削除（アイコンはlucideが再生成するため委任イベントで検知）
  elements.addedTagsList.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-tag-btn');
    if (!btn) return;
    removeTag(btn.dataset.tag);
  });

  // 新規登録：送信
  elements.formAddCard.addEventListener('submit', handleAddCardSubmit);

  // 設定：保存
  elements.btnSaveSettings.addEventListener('click', () => {
    const newId = elements.inputClientId.value.trim();
    if (!newId) {
      showToast('クライアントIDを入力してください');
      return;
    }
    
    const idChanged = STATE.clientId !== newId;
    STATE.clientId = newId;
    localStorage.setItem('clientId', STATE.clientId);
    
    showToast('設定を保存しました');
    
    if (idChanged) {
      initGoogleAuth();
    }
    
    checkSession();
  });

  // 設定：閉じる
  elements.btnCloseSettings.addEventListener('click', () => {
    checkSession();
  });

  // アカウント：ログアウト
  elements.btnLogout.addEventListener('click', logout);

  // 合戦モード：開く・閉じる
  elements.btnKassen.addEventListener('click', openKassenMode);
  elements.btnCloseKassen.addEventListener('click', () => {
    showScreen('screen-main');
  });

  // 合戦モード：タグ／イニシャル切り替え
  elements.kassenModeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.kassen-mode-btn');
    if (!btn) return;

    STATE.kassenMode = btn.dataset.mode;
    document.querySelectorAll('.kassen-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    elements.kassenResult.innerHTML = '';
    elements.kassenResult.classList.add('hidden');

    renderKassenMap();
  });

  // 合戦モード：ヘックスをタップすると、その名刺の名前をタップ位置の少し上にポップアップ表示
  elements.kassenMap.addEventListener('click', (e) => {
    const hex = e.target.closest('.kassen-hex');
    if (!hex) return;

    const card = STATE.cards.find(c => c.id === hex.dataset.cardId);
    if (!card) return;

    const wrapperRect = elements.kassenMapWrapper.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left;
    const y = e.clientY - wrapperRect.top;
    showKassenHexPopup(card.name, x, y);
  });

  // 合戦モード：合戦開始
  elements.btnStartKassen.addEventListener('click', startKassen);

  // 合戦モード：実況スキップ
  elements.btnSkipKassen.addEventListener('click', () => {
    kassenSkipRequested = true;
    if (kassenSkipResolver) kassenSkipResolver();
  });
}

function resetAddForm() {
  elements.formAddCard.reset();
  elements.photoPreview.src = '';
  elements.photoPreview.classList.add('hidden');
  elements.photoPlaceholder.classList.remove('hidden');
  STATE.addedTags = [];
  STATE.editingCardId = null;
  renderAddedTags();

  elements.addScreenTitle.textContent = '新規名刺登録';
  elements.btnSubmitText.textContent = 'Google ドライブへ保存';
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    elements.photoPreview.src = event.target.result;
    elements.photoPreview.classList.remove('hidden');
    elements.photoPlaceholder.classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

function addTagFromInput() {
  const val = elements.inputTag.value.trim();
  if (val && !STATE.addedTags.includes(val)) {
    STATE.addedTags.push(val);
    elements.inputTag.value = '';
    renderAddedTags();
  }
}

function removeTag(tag) {
  STATE.addedTags = STATE.addedTags.filter(t => t !== tag);
  renderAddedTags();
}

function renderAddedTags() {
  elements.addedTagsList.innerHTML = '';
  STATE.addedTags.forEach(tag => {
    const badge = document.createElement('span');
    badge.className = 'added-tag-badge';
    badge.innerHTML = `
      <span>${escapeHTML(tag)}</span>
      <i data-lucide="x" class="remove-tag-btn" data-tag="${tag}"></i>
    `;
    elements.addedTagsList.appendChild(badge);
  });

  renderExistingTagSuggestions();
  lucide.createIcons();
}

// 過去に登録した全名刺から使われているタグを集め、まだ追加していないものを候補として表示
function renderExistingTagSuggestions() {
  const allTagsSet = new Set();
  STATE.cards.forEach(card => {
    if (card.tags) card.tags.forEach(tag => allTagsSet.add(tag));
  });

  const availableTags = [...allTagsSet]
    .filter(tag => !STATE.addedTags.includes(tag))
    .sort((a, b) => a.localeCompare(b, 'ja'));

  elements.existingTagsList.innerHTML = '';

  if (availableTags.length === 0) {
    elements.existingTagsSection.classList.add('hidden');
    return;
  }

  elements.existingTagsSection.classList.remove('hidden');
  availableTags.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'existing-tag-chip';
    chip.textContent = tag;
    chip.addEventListener('click', () => addExistingTag(tag));
    elements.existingTagsList.appendChild(chip);
  });
}

// 既存タグ候補をクリックしたときの追加処理
function addExistingTag(tag) {
  if (!STATE.addedTags.includes(tag)) {
    STATE.addedTags.push(tag);
    renderAddedTags();
  }
}

// 新規登録・編集送信（画像アップロード＆メタデータ保存）
async function handleAddCardSubmit(e) {
  e.preventDefault();

  const isEditing = !!STATE.editingCardId;
  const file = elements.inputFile.files[0];

  // 新規登録時のみ画像は必須（編集時は既存画像を維持できる）
  if (!isEditing && !file && !elements.photoPreview.src) {
    showToast('名刺の画像を撮影または選択してください');
    return;
  }

  showLoading(isEditing ? '変更を保存中...' : 'Googleドライブに保存中...');

  try {
    const name = elements.inputName.value.trim();
    const alphabet = elements.inputAlphabet.value.trim();
    const memo = elements.inputMemo.value.trim();
    const tags = [...STATE.addedTags];

    if (isEditing) {
      const cardIndex = STATE.cards.findIndex(c => c.id === STATE.editingCardId);
      if (cardIndex === -1) {
        throw new Error('編集対象の名刺が見つかりません');
      }

      const targetCard = STATE.cards[cardIndex];
      let imageId = targetCard.imageId;

      // 新しい画像が選択されている場合のみ差し替え
      if (file) {
        imageId = await uploadImageToDrive(file, `${targetCard.id}.jpg`);

        if (targetCard.imageId) {
          await driveFetch(`${DRIVE_API_BASE}/files/${targetCard.imageId}`, { method: 'DELETE' });
          if (STATE.imageCache[targetCard.imageId]) {
            URL.revokeObjectURL(STATE.imageCache[targetCard.imageId]);
            delete STATE.imageCache[targetCard.imageId];
          }
        }
      }

      // チーム（タグ／イニシャル）が変わった場合のみ合戦マップ上の陣地を再配置し、
      // 変わっていなければ以前の位置をそのまま維持する
      const nextTeamSource = { id: targetCard.id, tags, alphabet };
      const prevKassenPos = targetCard.kassenPos || { tag: null, initial: null };
      const kassenPos = {
        tag: (prevKassenPos.tag && getKassenTeamKey(nextTeamSource, 'tag') === getKassenTeamKey(targetCard, 'tag'))
          ? prevKassenPos.tag
          : computeKassenCell(nextTeamSource, 'tag'),
        initial: (prevKassenPos.initial && getKassenTeamKey(nextTeamSource, 'initial') === getKassenTeamKey(targetCard, 'initial'))
          ? prevKassenPos.initial
          : computeKassenCell(nextTeamSource, 'initial')
      };

      STATE.cards[cardIndex] = { ...targetCard, name, alphabet, memo, tags, imageId, kassenPos };

      const saveSuccess = await saveMetadata();
      if (!saveSuccess) {
        throw new Error('Failed to update metadata.json');
      }

      showToast('名刺を更新しました');
    } else {
      let fileBlob = file;
      // ファイル選択でなくプレビューがある（例えば一部ブラウザで引き継がれた場合などの念のため）
      if (!fileBlob && elements.photoPreview.src.startsWith('data:')) {
        fileBlob = dataURLtoBlob(elements.photoPreview.src);
      }

      if (!fileBlob) {
        throw new Error('No valid image file');
      }

      const cardId = 'card_' + Date.now();
      const driveImageId = await uploadImageToDrive(fileBlob, `${cardId}.jpg`);

      const newCard = {
        id: cardId,
        name,
        alphabet,
        memo,
        tags,
        imageId: driveImageId,
        createdAt: new Date().toISOString(),
        kassenPos: { tag: null, initial: null }
      };
      // 合戦マップ上の陣地を確定（同タグ・同イニシャルの陣地に隣接するマスへ配置）
      newCard.kassenPos = {
        tag: computeKassenCell(newCard, 'tag'),
        initial: computeKassenCell(newCard, 'initial')
      };

      STATE.cards.push(newCard);
      const saveSuccess = await saveMetadata();
      if (!saveSuccess) {
        throw new Error('Failed to update metadata.json');
      }

      showToast('名刺を登録しました');
    }

    resetAddForm();
    showScreen('screen-main');
    renderApp();

  } catch (error) {
    console.error('Card Save Error:', error);
    showToast(isEditing ? '更新中にエラーが発生しました' : '登録中にエラーが発生しました');
  } finally {
    hideLoading();
  }
}

// -------------------------------------------------------------
// KASSEN MODE（合戦モード・完全ユーモア機能）
// -------------------------------------------------------------
const KASSEN_PALETTE = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399',
  '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#facc15',
  '#4ade80', '#38bdf8'
];
const KASSEN_NEUTRAL_COLOR = '#64748b';
const KASSEN_NEUTRAL_KEYS = ['無所属', '?'];

// axial座標の6方向（フラットトップ六角形）
const HEX_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

function openKassenMode() {
  STATE.kassenMode = 'tag';
  document.querySelectorAll('.kassen-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'tag');
  });
  elements.kassenResult.innerHTML = '';
  elements.kassenResult.classList.add('hidden');
  elements.kassenCommentary.classList.add('hidden');
  elements.btnStartKassen.classList.remove('hidden');
  setKassenControlsDisabled(false);

  renderKassenMap();
  showScreen('screen-kassen');
}

// カードが所属する軍のキー一覧を返す。タグモードでタグを2つ以上持つ場合は、
// 先頭2つのタグそれぞれの軍に所属する（＝2つの軍を掛け持ちする）。
// イニシャルモードはアルファベットが1つしかないため常に1軍のみ。
function getKassenTeamKeys(card, mode) {
  if (mode === 'tag') {
    if (!card.tags || card.tags.length === 0) return ['無所属'];
    return card.tags.slice(0, 2);
  }
  const initial = (card.alphabet || '').trim().charAt(0).toUpperCase();
  return [initial || '?'];
}

// カード1枚の「主」チームキー（陣地の色・地図上の配置に使用。所属は1つに固定する必要があるため先頭のみ）
function getKassenTeamKey(card, mode) {
  return getKassenTeamKeys(card, mode)[0];
}

// カードが指定した軍に所属しているか（掛け持ち軍も含めて判定）
function kassenCardBelongsToTeam(card, team, mode) {
  return getKassenTeamKeys(card, mode).includes(team);
}

// 登録名刺をチームごとにグルーピング（Map<チーム名, カード配列>）。
// 複数タグを持つカードは、所属する全ての軍の配列に重複して含まれる。
function buildKassenTeams(mode) {
  const teamMap = new Map();
  STATE.cards.forEach(card => {
    getKassenTeamKeys(card, mode).forEach(key => {
      if (!teamMap.has(key)) teamMap.set(key, []);
      teamMap.get(key).push(card);
    });
  });
  return teamMap;
}

// チーム名から表示色を決定（無所属/不明は常にグレー、それ以外はパレットを順番に割当）
function getKassenTeamColor(sortedTeamKeys, key) {
  if (KASSEN_NEUTRAL_KEYS.includes(key)) return KASSEN_NEUTRAL_COLOR;
  const coloredKeys = sortedTeamKeys.filter(k => !KASSEN_NEUTRAL_KEYS.includes(k));
  const idx = coloredKeys.indexOf(key);
  return KASSEN_PALETTE[idx % KASSEN_PALETTE.length];
}

function kassenCellKey(q, r) {
  return `${q},${r}`;
}

function getHexNeighbors(q, r) {
  return HEX_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

// 候補セルの中から、既に自チームの陣地に多く接しているもの（＝凹みを埋める配置）ほど
// 選ばれやすいよう重み付けした上でランダムに選ぶ（厳密な最優先ではなく確率的な傾向）。
// これにより、細い枝が伸びすぎるのを抑えつつも、時々自然な突起ができる程度のバランスにする。
// sameTeamSetが無い場合（新チームの初期配置等）は単純ランダム。
function pickBestCandidate(candidates, sameTeamSet) {
  if (!sameTeamSet || sameTeamSet.size === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const scored = candidates.map(cell => {
    const touchCount = getHexNeighbors(cell.q, cell.r).filter(n => sameTeamSet.has(kassenCellKey(n.q, n.r))).length;
    return { cell, weight: touchCount + 1 };
  });

  const totalWeight = scored.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const s of scored) {
    roll -= s.weight;
    if (roll <= 0) return s.cell;
  }
  return scored[scored.length - 1].cell;
}

// occupied（使用済みセルの集合）を避けつつ、sources（起点となる複数セル）から
// 同時多点BFSで空きセルを探す。同じ近さの候補が複数あれば、自陣への接触数が多いものを優先しつつ
// 同点はランダムに選ぶことで、陣地の輪郭が幾何学的にならず自然な海岸線のようにギザギザになる。
// sourcesが空なら大陸の一番最初の一枚として原点を返す。
function findNextFreeCell(occupied, sources, sameTeamSet) {
  if (sources.length === 0) {
    return { q: 0, r: 0 };
  }

  const visited = new Set(sources.map(s => kassenCellKey(s.q, s.r)));
  let frontier = sources;

  while (frontier.length > 0) {
    const freeAtThisDistance = [];
    const nextFrontier = [];
    for (const cell of frontier) {
      for (const n of getHexNeighbors(cell.q, cell.r)) {
        const key = kassenCellKey(n.q, n.r);
        if (visited.has(key)) continue;
        visited.add(key);
        if (!occupied.has(key)) {
          freeAtThisDistance.push(n);
        } else {
          nextFrontier.push(n);
        }
      }
    }
    if (freeAtThisDistance.length > 0) {
      return pickBestCandidate(freeAtThisDistance, sameTeamSet);
    }
    frontier = nextFrontier;
  }
  return { q: 0, r: 0 }; // 無限グリッドのため理論上到達しない
}

function hexDistanceFromOrigin(q, r) {
  return (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2;
}

// 原点を中心とした半径radiusの輪（リング）を構成する全セルを返す
function hexRingCells(radius) {
  if (radius === 0) return [{ q: 0, r: 0 }];
  const results = [];
  let hex = { q: HEX_DIRECTIONS[4].q * radius, r: HEX_DIRECTIONS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push({ ...hex });
      hex = { q: hex.q + HEX_DIRECTIONS[side].q, r: hex.r + HEX_DIRECTIONS[side].r };
    }
  }
  return results;
}

// 既存の大陸の外周から少し離れた場所に、新しい島の種となるセルをランダムに選ぶ
function pickIslandSeed(allCells) {
  const maxRadius = allCells.reduce((max, c) => Math.max(max, hexDistanceFromOrigin(c.q, c.r)), 0);
  const gap = 2 + Math.floor(Math.random() * 3); // 本土から2〜4マス分離す
  const ring = hexRingCells(maxRadius + gap);
  return ring[Math.floor(Math.random() * ring.length)];
}

// 新しいチームが誕生したときに、本土にくっつけるか、離れた新しい島として配置するかの確率
const KASSEN_NEW_TEAM_ISLAND_CHANCE = 0.15;

// 名刺1枚を配置するセルを決定する。
// 同じチームの名刺が既に地図上にあれば、その隣接マスを優先して選び陣地が繋がって広がるようにする。
// チームが地図上にまだ無ければ、一定確率で大陸の縁にくっつけ、それ以外は少し離れた新しい島として配置する
// （世界地図のように複数の大陸・離島がある見た目にするため）。地図が完全に空なら原点(0,0)を返す。
function computeKassenCell(card, mode) {
  const occupied = new Set();
  const teammateCells = [];
  const sameTeamSet = new Set();
  const allCells = [];
  const team = getKassenTeamKey(card, mode);

  STATE.cards.forEach(other => {
    if (other.id === card.id) return;
    const pos = other.kassenPos && other.kassenPos[mode];
    if (!pos) return;

    const key = kassenCellKey(pos.q, pos.r);
    occupied.add(key);
    allCells.push(pos);
    if (getKassenTeamKey(other, mode) === team) {
      teammateCells.push(pos);
      sameTeamSet.add(key);
    }
  });

  if (teammateCells.length > 0) {
    return findNextFreeCell(occupied, teammateCells, sameTeamSet);
  }

  if (allCells.length > 0 && Math.random() < KASSEN_NEW_TEAM_ISLAND_CHANCE) {
    const seed = pickIslandSeed(allCells);
    return findNextFreeCell(occupied, [seed]);
  }

  return findNextFreeCell(occupied, allCells);
}

// まだ座標を持たない名刺（過去に登録された古いデータ等）に、登録順で座標を割り当てる。
// 1件ずつ順番に確定させることで、既に座標を持つ名刺の位置には一切影響しない。
function ensureKassenPositions(mode) {
  let changed = false;
  STATE.cards.forEach(card => {
    if (!card.kassenPos) card.kassenPos = { tag: null, initial: null };
    if (!card.kassenPos[mode]) {
      card.kassenPos[mode] = computeKassenCell(card, mode);
      changed = true;
    }
  });
  return changed;
}

// axial座標 -> ピクセル座標（フラットトップ六角形）
function hexAxialToPixel(q, r, size) {
  const x = size * 1.5 * q;
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

// フラットトップ六角形の頂点座標の文字列を生成
function hexPolygonPoints(cx, cy, size) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    points.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

let kassenPopupTimeout = null;

// タップ位置の少し上に名前ポップアップを表示する。マップ外へはみ出さないよう位置を補正する。
function showKassenHexPopup(name, x, y) {
  const popup = elements.kassenHexPopup;
  const wrapperRect = elements.kassenMapWrapper.getBoundingClientRect();

  popup.textContent = name;
  popup.classList.remove('hidden');

  const offset = 14;
  popup.style.transform = 'translate(-50%, -100%)';
  popup.style.left = `${x}px`;
  popup.style.top = `${y - offset}px`;

  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    const margin = 6;
    let clampedX = x;
    let clampedY = y - offset;
    let translateY = '-100%';

    const halfWidth = popupRect.width / 2;
    if (clampedX - halfWidth < margin) clampedX = halfWidth + margin;
    if (clampedX + halfWidth > wrapperRect.width - margin) clampedX = wrapperRect.width - halfWidth - margin;

    // 上に十分な余白が無い場合は、タップ位置のすぐ下に表示する
    if (clampedY - popupRect.height < margin) {
      clampedY = y + offset;
      translateY = '0';
    }

    popup.style.transform = `translate(-50%, ${translateY})`;
    popup.style.left = `${clampedX}px`;
    popup.style.top = `${clampedY}px`;
    popup.classList.add('visible');
  });

  clearTimeout(kassenPopupTimeout);
  kassenPopupTimeout = setTimeout(() => {
    popup.classList.remove('visible');
  }, 1800);
}

function hideKassenHexPopup() {
  clearTimeout(kassenPopupTimeout);
  elements.kassenHexPopup.classList.remove('visible');
}

function renderKassenMap() {
  const svg = elements.kassenMap;
  svg.innerHTML = '';
  hideKassenHexPopup();

  const cards = STATE.cards;
  if (cards.length === 0) {
    elements.kassenEmptyState.classList.remove('hidden');
    elements.kassenLegend.innerHTML = '';
    svg.setAttribute('viewBox', '-10 -10 20 20');
    return;
  }
  elements.kassenEmptyState.classList.add('hidden');

  // 座標未割当の名刺（過去データ等）があれば、登録順で確定させて地図に定着させる
  const positionsChanged = ensureKassenPositions(STATE.kassenMode);
  if (positionsChanged) {
    saveMetadata().catch(err => console.error('Kassen座標の保存に失敗しました:', err));
  }

  const teamMap = buildKassenTeams(STATE.kassenMode);
  const teamKeys = [...teamMap.keys()].sort((a, b) => a.localeCompare(b, 'ja'));

  const hexSize = 6;
  const pixelCoords = cards.map(card => {
    const pos = card.kassenPos[STATE.kassenMode];
    return hexAxialToPixel(pos.q, pos.r, hexSize);
  });

  const xs = pixelCoords.map(p => p.x);
  const ys = pixelCoords.map(p => p.y);
  const margin = hexSize * 1.4;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  svg.setAttribute('viewBox', `${minX.toFixed(2)} ${minY.toFixed(2)} ${(maxX - minX).toFixed(2)} ${(maxY - minY).toFixed(2)}`);

  cards.forEach((card, i) => {
    const team = getKassenTeamKey(card, STATE.kassenMode);
    const color = getKassenTeamColor(teamKeys, team);
    const { x, y } = pixelCoords[i];

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', hexPolygonPoints(x, y, hexSize * 0.94));
    poly.setAttribute('fill', color);
    poly.setAttribute('fill-opacity', '0.85');
    poly.classList.add('kassen-hex');
    poly.dataset.team = team;
    poly.dataset.cardId = card.id;

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${card.name}（${team}）`;
    poly.appendChild(title);

    svg.appendChild(poly);
  });

  renderKassenLegend(teamMap, teamKeys);
}

function renderKassenLegend(teamMap, teamKeys) {
  elements.kassenLegend.innerHTML = teamKeys.map(key => {
    const color = getKassenTeamColor(teamKeys, key);
    const count = teamMap.get(key).length;
    return `
      <div class="kassen-legend-item">
        <span class="kassen-legend-dot" style="background:${color}"></span>
        <span class="kassen-legend-label">${escapeHTML(key)}</span>
        <span class="kassen-legend-count">${count}</span>
      </div>
    `;
  }).join('');
}

// 敗退実況の言い回しバリエーション（{team}, {name} を置換して使用）
const KASSEN_NARRATION_TEMPLATES = [
  '【{team}】{name}の活躍むなしく、惜しくも敗退…',
  '【{team}】{name}、健闘及ばず脱落…',
  '【{team}】{name}が奮戦するも、力及ばず敗退…',
  '【{team}】ここで{team}が脱落。{name}、お疲れ様でした…'
];
const KASSEN_NARRATION_STEP_MS = 1800;

let kassenSkipRequested = false;
let kassenSkipResolver = null;

// ms待つが、スキップされた場合は即座に解決される中断可能な待機
function kassenInterruptibleDelay(ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      kassenSkipResolver = null;
      resolve();
    }, ms);
    kassenSkipResolver = () => {
      clearTimeout(timer);
      kassenSkipResolver = null;
      resolve();
    };
  });
}

function setKassenControlsDisabled(disabled) {
  document.querySelectorAll('.kassen-mode-btn').forEach(b => { b.disabled = disabled; });
  elements.btnCloseKassen.disabled = disabled;
}

async function startKassen() {
  if (STATE.cards.length === 0) {
    showToast('名刺が登録されていません');
    return;
  }

  // 前回のハイライト・結果をリセット（再戦時にも使えるように）
  document.querySelectorAll('.kassen-hex').forEach(hex => {
    hex.classList.remove('kassen-hex-winner', 'kassen-hex-loser');
  });
  elements.kassenResult.innerHTML = '';
  elements.kassenResult.classList.add('hidden');
  hideKassenHexPopup();

  const teamMap = buildKassenTeams(STATE.kassenMode);
  const teamKeys = [...teamMap.keys()];
  const cardById = new Map(STATE.cards.map(c => [c.id, c]));

  // シャッフルして脱落順を決定する（最後に残った1チームが勝者）
  for (let i = teamKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teamKeys[i], teamKeys[j]] = [teamKeys[j], teamKeys[i]];
  }
  const winningTeam = teamKeys[teamKeys.length - 1];
  const eliminationOrder = teamKeys.slice(0, teamKeys.length - 1);

  kassenSkipRequested = false;
  setKassenControlsDisabled(true);
  elements.btnStartKassen.classList.add('hidden');
  elements.kassenCommentaryText.textContent = '合戦開始…！';
  elements.kassenCommentary.classList.remove('hidden');

  await kassenInterruptibleDelay(900);

  for (const team of eliminationOrder) {
    if (kassenSkipRequested) break;

    const members = teamMap.get(team);
    const featured = members[Math.floor(Math.random() * members.length)];
    const template = KASSEN_NARRATION_TEMPLATES[Math.floor(Math.random() * KASSEN_NARRATION_TEMPLATES.length)];
    elements.kassenCommentaryText.textContent = template.replace(/\{team\}/g, team).replace(/\{name\}/g, featured.name);

    document.querySelectorAll('.kassen-hex').forEach(hex => {
      const card = cardById.get(hex.dataset.cardId);
      if (card && kassenCardBelongsToTeam(card, team, STATE.kassenMode)) {
        hex.classList.add('kassen-hex-loser');
      }
    });

    if (kassenSkipRequested) break;
    await kassenInterruptibleDelay(KASSEN_NARRATION_STEP_MS);
  }

  // スキップされた場合も含め、勝者以外は必ず敗退表示に揃える。
  // 掛け持ち軍のカードは、地図上の色は主タグのままでも、勝利軍に所属していれば勝者表示になる。
  document.querySelectorAll('.kassen-hex').forEach(hex => {
    const card = cardById.get(hex.dataset.cardId);
    if (card && kassenCardBelongsToTeam(card, winningTeam, STATE.kassenMode)) {
      hex.classList.add('kassen-hex-winner');
      hex.classList.remove('kassen-hex-loser');
    } else {
      hex.classList.add('kassen-hex-loser');
    }
  });

  elements.kassenCommentary.classList.add('hidden');
  elements.btnStartKassen.classList.remove('hidden');
  setKassenControlsDisabled(false);

  const candidates = teamMap.get(winningTeam);
  const mvp = candidates[Math.floor(Math.random() * candidates.length)];
  await showKassenResult(winningTeam, mvp);
}

async function showKassenResult(team, mvp) {
  let imageUrl = '';
  if (mvp.imageId) {
    imageUrl = await fetchCardImage(mvp.imageId);
  }

  elements.kassenResult.innerHTML = `
    <div class="kassen-result-card glass-card">
      <div class="kassen-result-badge">🏆 勝利軍: ${escapeHTML(team)}</div>
      <button type="button" id="kassen-mvp-link" class="kassen-mvp kassen-mvp-clickable" title="この名刺を見る">
        <div class="kassen-mvp-image-wrapper">
          ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHTML(mvp.name)}">` : '<i data-lucide="user"></i>'}
        </div>
        <div class="kassen-mvp-info">
          <span class="kassen-mvp-label">本日のMVP</span>
          <h3>${escapeHTML(mvp.name)}</h3>
          <div class="alphabet">${escapeHTML(mvp.alphabet)}</div>
        </div>
        <i data-lucide="chevron-right" class="kassen-mvp-arrow"></i>
      </button>
    </div>
  `;
  elements.kassenResult.classList.remove('hidden');
  lucide.createIcons();

  const mvpLink = document.getElementById('kassen-mvp-link');
  if (mvpLink) {
    mvpLink.addEventListener('click', () => goToCardFromKassen(mvp.id));
  }
}

// MVPの名刺タップで合戦モードを抜け、メイン画面でその名刺までスクロールする
function goToCardFromKassen(cardId) {
  showScreen('screen-main');

  elements.searchInput.value = '';
  elements.btnClearSearch.classList.add('hidden');
  STATE.selectedTag = 'all';
  renderApp();

  const index = STATE.filteredCards.findIndex(c => c.id === cardId);
  if (index !== -1) {
    scrollToCard(index, false);
  } else {
    showToast('名刺が見つかりませんでした');
  }
}

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function dataURLtoBlob(dataurl) {
  var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  while(n--){
      u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], {type:mime});
}

// Service Worker の登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('ServiceWorker registration successful with scope: ', reg.scope))
      .catch(err => console.log('ServiceWorker registration failed: ', err));
  });

  // 新しいService Workerが有効化されたら自動的にページを再読み込みし、
  // 最新版への切り替えを手動での開き直しなしで反映する
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}
