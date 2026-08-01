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
  inputTag: document.getElementById('input-tag'),
  btnAddTag: document.getElementById('btn-add-tag'),
  addedTagsList: document.getElementById('added-tags-list'),
  btnCancelAdd: document.getElementById('btn-cancel-add'),
  btnSubmitCard: document.getElementById('btn-submit-card'),
  // Settings Screen
  inputClientId: document.getElementById('input-client-id'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnCloseSettings: document.getElementById('btn-close-settings'),
  userName: document.getElementById('user-name'),
  userEmail: document.getElementById('user-email'),
  userAvatar: document.getElementById('user-avatar'),
  btnLogout: document.getElementById('btn-logout'),
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
      emptyAddBtn.addEventListener('click', () => showScreen('screen-add'));
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
          <button class="btn-icon btn-delete-card" data-id="${card.id}" style="border:none; background:transparent; color:var(--text-muted);" title="削除">
            <i data-lucide="trash-2" style="width:18px; height:18px;"></i>
          </button>
        </div>
        <div class="card-tags">
          ${card.tags ? card.tags.map(t => `<span class="card-tag">${escapeHTML(t)}</span>`).join('') : ''}
        </div>
      </div>
    `;

    container.appendChild(cardEl);
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
}

function resetAddForm() {
  elements.formAddCard.reset();
  elements.photoPreview.src = '';
  elements.photoPreview.classList.add('hidden');
  elements.photoPlaceholder.classList.remove('hidden');
  STATE.addedTags = [];
  renderAddedTags();
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
  
  // バッジ内の削除ボタンにイベント登録
  elements.addedTagsList.querySelectorAll('.remove-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => removeTag(btn.dataset.tag));
  });
  
  lucide.createIcons();
}

// 新規登録送信（画像アップロード＆メタデータ保存）
async function handleAddCardSubmit(e) {
  e.preventDefault();

  const file = elements.inputFile.files[0];
  if (!file && !elements.photoPreview.src) {
    showToast('名刺の画像を撮影または選択してください');
    return;
  }

  showLoading('Googleドライブに保存中...');

  try {
    let fileBlob = file;
    // ファイル選択でなくプレビューがある（例えば一部ブラウザで引き継がれた場合などの念のため）
    if (!fileBlob && elements.photoPreview.src.startsWith('data:')) {
      fileBlob = dataURLtoBlob(elements.photoPreview.src);
    }

    if (!fileBlob) {
      throw new Error('No valid image file');
    }

    const cardId = 'card_' + Date.now();
    const filename = `${cardId}.jpg`;

    // 1. 画像ファイルをGoogleドライブへアップロード
    const driveImageId = await uploadImageToDrive(fileBlob, filename);

    // 2. メタデータオブジェクトを作成
    const newCard = {
      id: cardId,
      name: elements.inputName.value.trim(),
      alphabet: elements.inputAlphabet.value.trim(),
      tags: [...STATE.addedTags],
      imageId: driveImageId,
      createdAt: new Date().toISOString()
    };

    // 3. ローカルのリストに追加し、ドライブへ保存
    STATE.cards.push(newCard);
    const saveSuccess = await saveMetadata();

    if (saveSuccess) {
      showToast('名刺を登録しました');
      resetAddForm();
      showScreen('screen-main');
      renderApp();
    } else {
      throw new Error('Failed to update metadata.json');
    }

  } catch (error) {
    console.error('Card Registration Error:', error);
    showToast('登録中にエラーが発生しました');
  } finally {
    hideLoading();
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
}
