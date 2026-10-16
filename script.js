
'use strict';

/* =========================================================
   LUMINA — SCRIPT PRINCIPAL OPTIMIZADO
   Supabase · Feed · Multimedia · Cámara · Filtros
   ========================================================= */

/* -------------------- CONFIGURACIÓN -------------------- */

const SUPABASE_URL =
  'https://crmlyayzknjojjnsxpej.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_ywTHI-07EYSo5-ZH5Lyifw_U28_vM77';

const MEDIA_BUCKET = 'fotos';
const AUDIO_BUCKET = 'audio';
const MAX_FILE_SIZE_MB = 100;

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    )
  : null;

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

const feed = $('#feed');
const feedStatus = $('#feed-status');
const fileInput = $('#file-input');
const audioInput = $('#audio-input');
const previewModal = $('#preview-modal');
const previewContainer = $('#preview-container');
const captionInput = $('#caption-input');
const hashtagsInput = $('#hashtags-input');
const publishBtn = $('#publish-btn');
const commentsModal = $('#comments-modal');
const commentsList = $('#comments-list');
const newCommentInput = $('#new-comment-input');
const commentForm = $('#comment-form');
const searchInput = $('#search-input');

let selectedFile = null;
let selectedAudioFile = null;
let selectedType = 'image';
let selectedFilter = 'normal';
let activePostForComments = null;
let allPosts = [];
let previewObjectUrl = null;
let isPublishing = false;

let activePostElement = null;
let postObserver = null;
let feedMutationObserver = null;
let feedLoopLocked = false;
let feedLoopTimer = null;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let cameraFacingMode = 'environment';
let recording = false;

/*
 * Preferencia global de sonido:
 * false = intentar reproducir con sonido.
 * true  = mantener los videos silenciados.
 *
 * Si el navegador bloquea el sonido automático,
 * se intentará reproducir el video silenciado.
 */
let userMutedVideos = false;

const likedPosts = new Set();

const TYPE_ACCEPT = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file: '.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.csv'
};

const FILTER_CLASSES = {
  normal: '',
  vintage: 'filter-vintage',
  cyber: 'filter-cyber',
  bw: 'filter-bw'
};

/* -------------------- UTILIDADES -------------------- */

function showToast(message, isError = false) {
  const container = $('#toast-container');

  if (!container) {
    console[isError ? 'error' : 'log'](message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3500);
}

function setFeedStatus(message = '') {
  if (feedStatus) feedStatus.textContent = message;
}

function formatCount(value) {
  const number = Number(value) || 0;

  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1).replace('.0', '')} M`;
  }

  if (number >= 1000) {
    return `${(number / 1000).toFixed(1).replace('.0', '')} mil`;
  }

  return String(number);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name) {
  return String(name || 'archivo')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-100) || 'archivo';
}

function getPostId(post) {
  return post?.id == null ? '' : String(post.id);
}

function createElement(tag, className = '', text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function showMediaError(container, message) {
  if (!container || $('.media-error-message', container)) return;

  container.appendChild(
    createElement('p', 'media-error-message', message)
  );
}

function resetPreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = null;
}

function getStoragePublicUrl(bucket, path) {
  if (!supabaseClient || !path) return '';

  const cleanPath = String(path).replace(/^\/+/, '');

  return supabaseClient.storage
    .from(bucket)
    .getPublicUrl(cleanPath)?.data?.publicUrl || '';
}

function resolveMediaUrl(value, bucket = MEDIA_BUCKET) {
  if (!value) return '';

  const url = String(value).trim();

  if (/^(https?:\/\/|blob:|data:)/i.test(url)) {
    return url;
  }

  if (url.startsWith('//')) {
    return `${location.protocol}${url}`;
  }

  return getStoragePublicUrl(
    bucket,
    url.replace(/^\/+/, '')
  );
}

function fileMatchesType(file, type) {
  if (!file) return false;

  if (type === 'image') return file.type.startsWith('image/');
  if (type === 'video') return file.type.startsWith('video/');
  if (type === 'audio') return file.type.startsWith('audio/');

  if (type === 'file') {
    return !/^(image|video|audio)\//i.test(file.type);
  }

  return false;
}

function applyFileAccept() {
  if (fileInput) {
    fileInput.accept = TYPE_ACCEPT[selectedType] || '*/*';
  }
}

function filterFromPost(post) {
  const value = String(post.filter || '')
    .replace(/^filter-/, '');

  return FILTER_CLASSES[value] !== undefined
    ? FILTER_CLASSES[value]
    : '';
}

function checkSupabase() {
  if (!window.supabase?.createClient) {
    setFeedStatus(
      'No se encontró la biblioteca de Supabase. Revisa index.html.'
    );
    return false;
  }

  if (
    !SUPABASE_URL.startsWith('https://') ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes('PEGA_AQUI')
  ) {
    setFeedStatus('Configura la URL y la clave publicable de Supabase.');
    return false;
  }

  if (!supabaseClient) {
    setFeedStatus('No se pudo inicializar Supabase.');
    return false;
  }

  return true;
}

/* =========================================================
   COMPOSITOR: PUBLICAR CONTENIDO
   ========================================================= */

function resetComposer() {
  stopCamera();
  resetPreviewUrl();

  selectedFile = null;
  selectedAudioFile = null;
  selectedType = 'image';
  selectedFilter = 'normal';

  if (fileInput) fileInput.value = '';
  if (audioInput) audioInput.value = '';
  if (captionInput) captionInput.value = '';
  if (hashtagsInput) hashtagsInput.value = '';

  const elements = {
    counter: $('#caption-counter'),
    fileInfo: $('#file-info'),
    audioInfo: $('#audio-info'),
    error: $('#publish-error'),
    progressContainer: $('#upload-progress-container'),
    progress: $('#upload-progress'),
    status: $('#upload-status')
  };

  if (elements.counter) elements.counter.textContent = '0/150';
  if (elements.fileInfo) {
    elements.fileInfo.textContent = 'Ningún archivo seleccionado';
  }
  if (elements.audioInfo) elements.audioInfo.textContent = '';
  if (elements.error) elements.error.textContent = '';
  if (elements.progressContainer) elements.progressContainer.hidden = true;
  if (elements.progress) elements.progress.value = 0;
  if (elements.status) elements.status.textContent = '';

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === 'image');
  });

  $$('.filter-tag').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === 'normal');
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.filter === 'normal')
    );
  });

  applyFileAccept();
  renderPreview();
  updatePublishButton();
}

function openComposer() {
  if (!previewModal) return;

  resetComposer();
  previewModal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeComposer() {
  if (isPublishing || !previewModal) return;

  previewModal.hidden = true;
  document.body.classList.remove('modal-open');
  stopCamera();
  resetComposer();
}

function setSelectedType(type) {
  selectedType = TYPE_ACCEPT[type] ? type : 'image';

  $$('.media-type').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.type === selectedType
    );
  });

  applyFileAccept();

  if (selectedFile && !fileMatchesType(selectedFile, selectedType)) {
    selectedFile = null;

    if (fileInput) fileInput.value = '';

    const info = $('#file-info');
    if (info) info.textContent = 'Elige un archivo del tipo seleccionado';

    resetPreviewUrl();
  }

  renderPreview();
  updatePublishButton();
}

function updatePublishButton() {
  if (publishBtn) {
    publishBtn.disabled = !selectedFile || isPublishing;
  }
}

function renderPreview() {
  if (!previewContainer) return;

  previewContainer.replaceChildren();

  if (!selectedFile) {
    const placeholder = createElement('div', 'preview-placeholder');
    const icon = createElement('i');
    icon.className = 'fa-regular fa-images';

    placeholder.append(
      icon,
      createElement('p', '', 'La vista previa aparecerá aquí')
    );

    previewContainer.appendChild(placeholder);
    applyPreviewFilter();
    return;
  }

  const filterClass = FILTER_CLASSES[selectedFilter] || '';

  if (selectedType === 'image') {
    const image = createElement('img');
    image.src = previewObjectUrl;
    image.alt = 'Vista previa de la imagen';
    image.className = filterClass;
    previewContainer.appendChild(image);

  } else if (selectedType === 'video') {
    const video = createElement('video');
    video.src = previewObjectUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.className = filterClass;
    previewContainer.appendChild(video);

  } else if (selectedType === 'audio') {
    const card = createElement('div', 'audio-preview-card');
    const icon = createElement('i');
    icon.className = 'fa-solid fa-music';

    const title = createElement('strong', '', selectedFile.name);
    const audio = createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = previewObjectUrl;

    card.append(icon, title, audio);
    previewContainer.appendChild(card);

  } else {
    const card = createElement('div', 'file-preview-card');
    const icon = createElement('i');
    icon.className = 'fa-solid fa-file-lines';

    card.append(
      icon,
      createElement('strong', '', selectedFile.name),
      createElement('small', '', formatBytes(selectedFile.size))
    );

    previewContainer.appendChild(card);
  }

  applyPreviewFilter();
}

function applyPreviewFilter() {
  const classes = Object.values(FILTER_CLASSES).filter(Boolean);
  const media = $('#preview-container img, #preview-container video');

  if (media) {
    media.classList.remove(...classes);

    const currentClass = FILTER_CLASSES[selectedFilter];
    if (currentClass) media.classList.add(currentClass);
  }

  const cameraVideo = $('#lumina-camera-video');

  if (cameraVideo) {
    cameraVideo.classList.remove(...classes);

    const currentClass = FILTER_CLASSES[selectedFilter];
    if (currentClass) cameraVideo.classList.add(currentClass);
  }
}

function onMainFileChange() {
  const file = fileInput?.files?.[0];
  if (!file) return;

  if (!fileMatchesType(file, selectedType)) {
    showToast('El archivo no coincide con el tipo seleccionado.', true);
    fileInput.value = '';
    return;
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`, true);
    fileInput.value = '';
    return;
  }

  resetPreviewUrl();

  selectedFile = file;
  previewObjectUrl = URL.createObjectURL(file);

  const info = $('#file-info');
  if (info) {
    info.textContent = `${file.name} · ${formatBytes(file.size)}`;
  }

  renderPreview();
  updatePublishButton();
}

/* =========================================================
   MEDIOS DE LAS PUBLICACIONES
   ========================================================= */

function createMedia(post) {
  const type = post.media_type || 'image';

  const mainUrl = resolveMediaUrl(
    post.image_url || post.media_url || post.file_url,
    MEDIA_BUCKET
  );

  const mediaWrap = createElement('div', 'post-media-wrap');

  if (!mainUrl) {
    mediaWrap.appendChild(
      createElement('div', 'media-unavailable', 'Contenido no disponible')
    );

    return { mediaWrap, mediaElement: null };
  }

  const filterClass = filterFromPost(post);

  if (type === 'video') {
    const video = createElement('video', `post-media ${filterClass}`.trim());

    video.src = mainUrl;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = true;

    /*
     * Se intenta sonido cuando la publicación se vuelve activa.
     * No forzamos muted=true aquí: eso impediría el primer intento
     * de reproducción automática con sonido.
     */
    video.muted = false;
    video.dataset.soundReady = 'false';

    const soundBtn = createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'sound-toggle';
    soundBtn.setAttribute('aria-label', 'Silenciar');
    soundBtn.setAttribute('aria-pressed', 'false');

    function updateSoundButton() {
      const muted = video.muted || video.volume === 0;

      soundBtn.innerHTML = muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';

      soundBtn.setAttribute(
        'aria-label',
        muted ? 'Activar sonido' : 'Silenciar'
      );

      soundBtn.setAttribute('aria-pressed', String(!muted));
    }

    soundBtn.addEventListener('click', async event => {
      event.stopPropagation();

      userMutedVideos = !video.muted;

      if (userMutedVideos) {
        video.muted = true;
        updateSoundButton();
        return;
      }

      video.muted = false;
      video.volume = 1;
      updateSoundButton();

      try {
        await video.play();
        video.dataset.soundReady = 'true';
      } catch {
        showToast(
          'Pulsa reproducir en el video para activar el sonido.',
          true
        );
      }
    });

    video.addEventListener('volumechange', updateSoundButton);

    video.addEventListener('play', () => {
      video.dataset.soundReady = String(!video.muted);
      updateSoundButton();
    });

    video.addEventListener('error', () => {
      showMediaError(mediaWrap, 'No se pudo cargar el video.');
    });

    updateSoundButton();
    mediaWrap.append(video, soundBtn);

    return { mediaWrap, mediaElement: video };
  }

  if (type === 'audio') {
    const card = createElement('div', 'post-audio-card');
    const art = createElement('div', 'audio-art');
    art.innerHTML = '<i class="fa-solid fa-music"></i>';

    const meta = createElement('div', 'audio-meta');
    meta.append(
      createElement(
        'strong',
        '',
        post.audio_title || post.caption || 'Pista de audio'
      ),
      createElement('small', '', 'Audio')
    );

    const audio = createElement('audio', 'post-audio-main');
    audio.src = mainUrl;
    audio.controls = true;
    audio.preload = 'metadata';

    audio.addEventListener('error', () => {
      showMediaError(card, 'No se pudo reproducir este audio.');
    });

    card.append(art, meta, audio);
    mediaWrap.appendChild(card);

    return { mediaWrap, mediaElement: audio };
  }

  if (type === 'file') {
    const link = createElement('a', 'post-file-card');
    link.href = mainUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const icon = createElement('i');
    icon.className = 'fa-solid fa-file-arrow-down';

    link.append(
      icon,
      createElement(
        'span',
        'file-name',
        post.file_name || post.caption || 'Archivo adjunto'
      ),
      createElement('small', '', 'Abrir o descargar archivo')
    );

    mediaWrap.appendChild(link);
    return { mediaWrap, mediaElement: null };
  }

  const image = createElement('img', `post-media ${filterClass}`.trim());
  image.src = mainUrl;
  image.alt = post.caption
    ? `Imagen: ${post.caption}`
    : 'Imagen de publicación';
  image.loading = 'lazy';

  image.addEventListener('error', () => {
    showMediaError(
      mediaWrap,
      'No se pudo cargar la imagen. Comprueba el acceso al bucket fotos.'
    );
  });

  mediaWrap.appendChild(image);
  return { mediaWrap, mediaElement: image };
}

/* =========================================================
   BOTONES DE ACCIÓN
   ========================================================= */

function makeAction(className, iconName, countText, label) {
  const wrapper = createElement('div', 'action-group');
  const button = createElement('button');

  button.type = 'button';
  button.className = `action-btn ${className}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="fa-solid ${iconName}"></i>`;

  const count = createElement('div', 'action-count', countText);
  wrapper.append(button, count);

  return { wrapper, button, count };
}

function toggleLike(post, group) {
  const id = getPostId(post);

  if (!id) {
    showToast('Esta publicación no tiene un identificador válido.', true);
    return;
  }

  const wasLiked = likedPosts.has(id);

  if (wasLiked) {
    likedPosts.delete(id);
  } else {
    likedPosts.add(id);
  }

  group.button.classList.toggle('liked', !wasLiked);

  const current = Math.max(
    0,
    (Number(post.likes_count) || 0) + (wasLiked ? -1 : 1)
  );

  post.likes_count = current;
  group.count.textContent = formatCount(current);

  showToast(
    wasLiked
      ? 'Me gusta quitado de esta sesión.'
      : 'Me gusta añadido en esta sesión.'
  );
}

async function loadCommentCount(postId, element) {
  if (!supabaseClient || !element) return;

  try {
    const { count, error } = await supabaseClient
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    if (!error && count !== null) {
      element.textContent = formatCount(count);
    }
  } catch (error) {
    console.warn('No se pudo consultar el contador de comentarios.', error);
  }
}

/* =========================================================
   CONSTRUIR UNA PUBLICACIÓN
   ========================================================= */

function renderPost(post) {
  const postEl = createElement('article', 'post');
  postEl.dataset.postId = getPostId(post);

  const { mediaWrap } = createMedia(post);
  postEl.appendChild(mediaWrap);

  const overlay = createElement('div', 'post-overlay');
  const userInfo = createElement('div', 'user-info');
  const username = String(post.username || 'usuario');

  const avatar = createElement('img', 'avatar');
  avatar.src =
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`;
  avatar.alt = '';
  avatar.loading = 'lazy';

  const userLabel = createElement(
    'span',
    'username',
    username.startsWith('@') ? username : `@${username}`
  );

  userInfo.append(avatar, userLabel);
  overlay.appendChild(userInfo);

  const caption = createElement(
    'p',
    'caption',
    [post.caption || '', post.hashtags || '']
      .filter(Boolean)
      .join(' ')
  );

  overlay.appendChild(caption);

  if (post.audio_url) {
    const audioLabel = createElement('p', 'audio-info');
    const icon = createElement('i');
    icon.className = 'fa-solid fa-music';

    audioLabel.append(
      icon,
      document.createTextNode(` ${post.audio_title || 'Audio adjunto'}`)
    );

    overlay.appendChild(audioLabel);
  }

  postEl.appendChild(overlay);

  const actionBar = createElement('div', 'action-bar');

  const likeGroup = makeAction(
    'like-btn',
    'fa-heart',
    formatCount(post.likes_count || 0),
    'Me gusta'
  );

  if (likedPosts.has(getPostId(post))) {
    likeGroup.button.classList.add('liked');
  }

  likeGroup.button.addEventListener('click', event => {
    event.stopPropagation();
    toggleLike(post, likeGroup);
  });

  const commentGroup = makeAction(
    'comment-btn',
    'fa-comment-dots',
    '0',
    'Comentarios'
  );

  commentGroup.button.addEventListener('click', event => {
    event.stopPropagation();
    openCommentsModal(post);
  });

  const shareGroup = makeAction(
    'share-btn',
    'fa-share',
    'Compartir',
    'Compartir publicación'
  );

  shareGroup.button.addEventListener('click', async event => {
    event.stopPropagation();

    const url = resolveMediaUrl(
      post.image_url || post.media_url || post.file_url,
      MEDIA_BUCKET
    ) || location.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Lumina',
          text: post.caption || 'Mira esta publicación en Lumina',
          url
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast('Enlace copiado.');
      } else {
        showToast('No se pudo compartir desde este navegador.', true);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        showToast('No se pudo compartir la publicación.', true);
      }
    }
  });

  actionBar.append(
    likeGroup.wrapper,
    commentGroup.wrapper,
    shareGroup.wrapper
  );

  if (post.audio_url || post.media_type === 'audio') {
    const vinyl = createElement('div', 'vinyl-disc');
    vinyl.innerHTML = '<i class="fa-solid fa-music"></i>';
    actionBar.appendChild(vinyl);
  }

  postEl.appendChild(actionBar);

  /*
   * El audio adicional conserva sus controles manuales.
   * No se reproduce a la vez que el video automáticamente,
   * evitando mezclar dos pistas de sonido.
   */
  if (post.audio_url && post.media_type !== 'audio') {
    const audioUrl = resolveMediaUrl(post.audio_url, AUDIO_BUCKET);

    if (audioUrl) {
      const audio = createElement('audio');
      audio.src = audioUrl;
      audio.preload = 'none';
      audio.controls = true;
      audio.loop = true;
      audio.setAttribute(
        'aria-label',
        'Audio adicional de la publicación'
      );

      const dock = createElement('div', 'post-audio-dock');
      dock.appendChild(audio);
      postEl.appendChild(dock);
    }
  }

  if (supabaseClient && post.id != null) {
    loadCommentCount(post.id, commentGroup.count);
  }

  return postEl;
}

/* =========================================================
   FEED: CARGAR Y FILTRAR PUBLICACIONES
   ========================================================= */

async function loadPosts() {
  if (!feed) {
    console.error('No existe el elemento #feed en index.html.');
    return;
  }

  setFeedStatus('Cargando publicaciones…');
  stopAllFeedMedia();
  feed.replaceChildren();

  if (!checkSupabase()) return;

  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    allPosts = Array.isArray(data) ? data : [];

    console.info(`Lumina: ${allPosts.length} publicaciones recuperadas.`);

    renderFilteredPosts();
  } catch (error) {
    console.error('Error cargando publicaciones:', error);

    setFeedStatus(
      `No se pudieron cargar las publicaciones: ${
        error.message || 'revisa la conexión y los permisos de posts.'
      }`
    );
  }
}

function renderFilteredPosts() {
  if (!feed) return;

  stopAllFeedMedia();
  activePostElement = null;
  feed.replaceChildren();

  const term = (searchInput?.value || '').trim().toLowerCase();
  const activeFeed =
    $('.top-tabs button.active')?.dataset.feed || 'for-you';

  let posts = [...allPosts];

  if (term) {
    posts = posts.filter(post => {
      const searchableText = [
        post.caption || '',
        post.username || '',
        post.hashtags || '',
        post.audio_title || '',
        post.file_name || ''
      ].join(' ').toLowerCase();

      return searchableText.includes(term);
    });
  }

  if (activeFeed === 'following') {
    setFeedStatus(
      'Para activar “Siguiendo” debes configurar usuarios y relaciones de seguimiento.'
    );
    return;
  }

  if (!posts.length) {
    setFeedStatus(
      term
        ? 'No hay publicaciones que coincidan con tu búsqueda.'
        : 'Todavía no hay publicaciones. ¡Comparte la primera!'
    );
    return;
  }

  setFeedStatus('');

  const fragment = document.createDocumentFragment();

  posts.forEach(post => {
    fragment.appendChild(renderPost(post));
  });

  feed.appendChild(fragment);

  // Los resultados nuevos comienzan siempre desde la publicación más reciente.
  feed.scrollTop = 0;

  observeFeedPosts();
}

/* =========================================================
   REPRODUCCIÓN INTELIGENTE Y AUDIO AUTOMÁTICO
   ========================================================= */

function pauseMediaInPost(postElement, muteVideos = true) {
  if (!postElement) return;

  $$('video, audio', postElement).forEach(media => {
    try {
      media.pause();

      if (media.tagName === 'VIDEO' && muteVideos) {
        media.muted = true;
      }
    } catch (error) {
      console.warn('No se pudo pausar un medio.', error);
    }
  });
}

function stopAllFeedMedia() {
  if (!feed) return;

  $$('#feed video, #feed audio').forEach(media => {
    try {
      media.pause();

      if (media.tagName === 'VIDEO') {
        media.muted = true;
      }
    } catch {
      // Continúa con los demás medios.
    }
  });
}

async function playActiveMedia(postElement) {
  if (!postElement || postElement !== activePostElement) return;

  const video = $('video.post-media', postElement);
  const mainAudio = $('audio.post-audio-main', postElement);

  if (video) {
    /*
     * Primero intentamos sonido real.
     * Si el navegador lo bloquea, probamos reproducción silenciada.
     */
    video.muted = userMutedVideos;

    try {
      await video.play();
      return;
    } catch (soundError) {
      if (postElement !== activePostElement) return;

      if (!userMutedVideos) {
        video.muted = true;

        try {
          await video.play();
          return;
        } catch (mutedError) {
          console.info(
            'El navegador requiere interacción para reproducir el video.',
            mutedError
          );
        }
      } else {
        console.info('El navegador bloqueó la reproducción automática.', soundError);
      }
    }

    return;
  }

  /*
   * En una publicación de audio se intenta reproducir su pista
   * principal cuando la publicación entra en pantalla.
   */
  if (mainAudio) {
    try {
      await mainAudio.play();
    } catch (error) {
      console.info(
        'Pulsa reproducir para escuchar esta publicación.',
        error
      );
    }
  }
}

function activatePost(postElement) {
  if (!postElement || postElement === activePostElement) return;

  // Corta el sonido anterior antes de iniciar el nuevo contenido.
  stopAllFeedMedia();

  activePostElement = postElement;

  // Solo el contenido de la publicación activa puede reproducirse.
  playActiveMedia(postElement);
}

function observeFeedPosts() {
  if (!feed || !('IntersectionObserver' in window)) {
    if (feed) {
      const firstPost = $('.post', feed);
      if (firstPost) activatePost(firstPost);
    }
    return;
  }

  if (!postObserver) {
    const visibleRatios = new Map();

    postObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        visibleRatios.set(
          entry.target,
          entry.isIntersecting ? entry.intersectionRatio : 0
        );
      });

      let bestPost = null;
      let bestRatio = 0;

      for (const [element, ratio] of visibleRatios) {
        if (!element.isConnected) {
          visibleRatios.delete(element);
          continue;
        }

        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestPost = element;
        }
      }

      if (bestPost && bestRatio >= 0.55) {
        activatePost(bestPost);
      }
    }, {
      root: feed,
      threshold: [0, 0.25, 0.4, 0.55, 0.7, 0.85, 1]
    });

    postObserver._visibleRatios = visibleRatios;
  }

  const observerRatios = postObserver._visibleRatios;

  $$('.post', feed).forEach(post => {
    if (post.dataset.observed === 'true') return;

    post.dataset.observed = 'true';
    postObserver.observe(post);
  });

  // Elimina referencias a publicaciones que ya no existen.
  for (const element of observerRatios.keys()) {
    if (!element.isConnected) {
      postObserver.unobserve(element);
      observerRatios.delete(element);
    }
  }
}

/* =========================================================
   FEED CIRCULAR: ÚLTIMA PUBLICACIÓN → MÁS RECIENTE
   ========================================================= */

function returnToNewestPost() {
  if (!feed || feedLoopLocked) return;

  const posts = $$('.post', feed);
  if (posts.length < 2) return;

  feedLoopLocked = true;

  // Se detiene el sonido antes de regresar al principio.
  stopAllFeedMedia();

  feed.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  window.clearTimeout(feedLoopTimer);

  feedLoopTimer = window.setTimeout(() => {
    feedLoopLocked = false;

    const firstPost = $('.post', feed);
    if (firstPost) activatePost(firstPost);
  }, 850);
}

function configureCircularFeed() {
  if (!feed || feed.dataset.circularFeedReady === 'true') return;

  feed.dataset.circularFeedReady = 'true';

  let scrollFramePending = false;

  feed.addEventListener('scroll', () => {
    if (scrollFramePending || feedLoopLocked) return;

    scrollFramePending = true;

    window.requestAnimationFrame(() => {
      scrollFramePending = false;

      const posts = $$('.post', feed);
      if (posts.length < 2) return;

      const remaining =
        feed.scrollHeight - feed.scrollTop - feed.clientHeight;

      // Activa el retorno al llegar al final del feed.
      if (remaining <= 8) {
        returnToNewestPost();
      }
    });
  }, { passive: true });
}

/* =========================================================
   COMENTARIOS
   ========================================================= */

async function openCommentsModal(post) {
  if (!post || post.id == null) {
    showToast('Esta publicación no tiene un identificador válido.', true);
    return;
  }

  if (!commentsModal || !commentsList) return;

  activePostForComments = post.id;
  commentsModal.hidden = false;
  document.body.classList.add('modal-open');
  commentsList.replaceChildren();

  const loading = createElement(
    'p',
    'empty-comments',
    'Cargando comentarios…'
  );

  commentsList.appendChild(loading);

  if (!supabaseClient) {
    loading.textContent = 'No hay conexión con Supabase.';
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('*')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw error;

    commentsList.replaceChildren();

    if (!data?.length) {
      commentsList.appendChild(
        createElement('p', 'empty-comments', 'Sé el primero en comentar.')
      );
      return;
    }

    data.forEach(comment => {
      const item = createElement('div', 'comment-item');
      const username = String(comment.username || 'usuario')
        .replace(/^@/, '');

      item.append(
        createElement('strong', '', `@${username}: `),
        createElement('span', '', comment.content || '')
      );

      commentsList.appendChild(item);
    });
  } catch (error) {
    commentsList.replaceChildren();

    commentsList.appendChild(
      createElement(
        'p',
        'empty-comments',
        `No se pudieron cargar los comentarios: ${
          error.message || 'error de conexión'
        }`
      )
    );
  }
}

async function submitComment(event) {
  event.preventDefault();

  const content = newCommentInput?.value.trim();

  if (!content || activePostForComments == null || !supabaseClient) {
    return;
  }

  const button = $('#send-comment-btn');
  if (button) button.disabled = true;

  try {
    const { error } = await supabaseClient
      .from('comments')
      .insert([{
        post_id: activePostForComments,
        content
      }]);

    if (error) throw error;

    newCommentInput.value = '';

    const post = allPosts.find(
      item => String(item.id) === String(activePostForComments)
    );

    if (post) await openCommentsModal(post);

    showToast('Comentario publicado.');
  } catch (error) {
    showToast(
      `No se pudo publicar el comentario: ${
        error.message || 'revisa los permisos de comments.'
      }`,
      true
    );
  } finally {
    if (button) button.disabled = false;
  }
}

function closeComments() {
  if (commentsModal) commentsModal.hidden = true;

  document.body.classList.remove('modal-open');
  activePostForComments = null;
}

/* =========================================================
   STORAGE: SUBIR ARCHIVOS
   ========================================================= */

async function uploadToBucket(bucket, file, prefix) {
  const uniqueId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const path =
    `${prefix}/${Date.now()}_${uniqueId}_${safeFileName(file.name)}`;

  const { error } = await supabaseClient.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });

  if (error) throw error;

  return {
    path,
    url: getStoragePublicUrl(bucket, path),
    bucket
  };
}

/* =========================================================
   PUBLICAR CONTENIDO
   ========================================================= */

async function publishPost() {
  if (isPublishing || !selectedFile) return;

  const publishError = $('#publish-error');

  if (!checkSupabase()) {
    if (publishError) {
      publishError.textContent =
        'Supabase no está disponible. No se ha publicado nada.';
    }
    return;
  }

  const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;

  if (selectedFile.size > maxBytes) {
    if (publishError) {
      publishError.textContent = 'El archivo supera el límite de 100 MB.';
    }
    return;
  }

  if (selectedAudioFile && selectedAudioFile.size > maxBytes) {
    if (publishError) {
      publishError.textContent =
        'El audio adicional supera el límite de 100 MB.';
    }
    return;
  }

  isPublishing = true;

  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.textContent = 'Publicando…';
  }

  if (publishError) publishError.textContent = '';

  const progressContainer = $('#upload-progress-container');
  const progress = $('#upload-progress');
  const uploadStatus = $('#upload-status');

  if (progressContainer) progressContainer.hidden = false;
  if (progress) progress.value = 10;
  if (uploadStatus) {
    uploadStatus.textContent = 'Subiendo archivo principal…';
  }

  try {
    const mainUpload = await uploadToBucket(
      MEDIA_BUCKET,
      selectedFile,
      selectedType
    );

    if (progress) progress.value = 50;

    let extraAudioUpload = null;

    if (selectedAudioFile) {
      if (uploadStatus) {
        uploadStatus.textContent = 'Subiendo audio adicional…';
      }

      extraAudioUpload = await uploadToBucket(
        AUDIO_BUCKET,
        selectedAudioFile,
        'audio'
      );
    }

    if (progress) progress.value = 75;
    if (uploadStatus) uploadStatus.textContent = 'Guardando publicación…';

    const row = {
      image_url: mainUpload.url,
      media_type: selectedType,
      caption: captionInput?.value.trim() || '',
      filter: selectedFilter === 'normal'
        ? ''
        : `filter-${selectedFilter}`,
      audio_url: extraAudioUpload?.url || null,
      audio_title: extraAudioUpload
        ? selectedAudioFile.name
        : (selectedType === 'audio' ? selectedFile.name : null)
    };

    const hashtags = hashtagsInput?.value.trim() || '';

    if (hashtags) row.hashtags = hashtags;
    if (selectedType === 'file') row.file_name = selectedFile.name;

    let { error } = await supabaseClient
      .from('posts')
      .insert([row]);

    // Compatibilidad con tablas que aún no tienen estas columnas.
    if (error && /hashtags|file_name/i.test(error.message || '')) {
      const retryRow = { ...row };
      delete retryRow.hashtags;
      delete retryRow.file_name;

      const retry = await supabaseClient
        .from('posts')
        .insert([retryRow]);

      error = retry.error;
    }

    if (error) throw error;

    if (progress) progress.value = 100;
    if (uploadStatus) uploadStatus.textContent = '¡Publicación guardada!';

    if (previewModal) previewModal.hidden = true;

    document.body.classList.remove('modal-open');
    stopCamera();
    resetComposer();

    await loadPosts();

    showToast('Publicación compartida.');
  } catch (error) {
    console.error('Error publicando:', error);

    if (publishError) {
      publishError.textContent =
        `No se pudo publicar: ${
          error.message || 'error desconocido'
        }. Revisa los permisos y las columnas de Supabase.`;
    }
  } finally {
    isPublishing = false;
    updatePublishButton();

    if (publishBtn) publishBtn.textContent = 'Publicar';
  }
}

/* =========================================================
   CÁMARA: TOMAR FOTOS Y GRABAR VIDEOS
   ========================================================= */

function buildCameraInterface() {
  const composerCard = $('#preview-modal .modal-card');
  if (!composerCard || !previewContainer) return;

  // Evita insertar la cámara más de una vez.
  if ($('#lumina-camera-section')) return;

  const cameraSection = createElement('section', 'camera-section');
  cameraSection.id = 'lumina-camera-section';

  cameraSection.innerHTML = `
    <div class="camera-tools">
      <button type="button" id="lumina-open-camera">
        <i class="fa-solid fa-camera"></i>
        <span>Abrir cámara</span>
      </button>

      <button type="button" id="lumina-take-photo" disabled>
        <i class="fa-solid fa-camera-retro"></i>
        <span>Tomar foto</span>
      </button>

      <button type="button" id="lumina-record-video" disabled>
        <i class="fa-solid fa-video"></i>
        <span>Grabar video</span>
      </button>
    </div>

    <div class="camera-stage" id="lumina-camera-stage" hidden>
      <video
        id="lumina-camera-video"
        autoplay
        muted
        playsinline
      ></video>
    </div>

    <div class="camera-controls">
      <button type="button" class="camera-control-btn"
        id="lumina-switch-camera" disabled>
        <i class="fa-solid fa-camera-rotate"></i>
        Cambiar cámara
      </button>

      <button type="button" class="camera-control-btn"
        id="lumina-stop-camera" hidden>
        <i class="fa-solid fa-stop"></i>
        Cerrar cámara
      </button>
    </div>

    <p class="camera-status" id="lumina-camera-status" aria-live="polite">
      Puedes tomar una foto o grabar un video.
    </p>
  `;

  const mediaSelector = composerCard.querySelector('.media-type-selector');

  if (mediaSelector) {
    mediaSelector.insertAdjacentElement('afterend', cameraSection);
  } else {
    previewContainer.insertAdjacentElement('beforebegin', cameraSection);
  }

  $('#lumina-open-camera')?.addEventListener('click', openCamera);
  $('#lumina-take-photo')?.addEventListener('click', takePhoto);
  $('#lumina-record-video')?.addEventListener('click', toggleRecording);
  $('#lumina-switch-camera')?.addEventListener('click', switchCamera);

  $('#lumina-stop-camera')?.addEventListener('click', () => {
    stopCamera();
    setCameraStatus('Cámara cerrada.');
  });
}

function setCameraStatus(message, type = '') {
  const status = $('#lumina-camera-status');
  if (!status) return;

  status.textContent = message;
  status.className = `camera-status ${type}`.trim();
}

function stopCamera() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch (error) {
      console.warn('No se pudo detener la grabación.', error);
    }
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  cameraStream = null;

  const cameraVideo = $('#lumina-camera-video');
  if (cameraVideo) cameraVideo.srcObject = null;

  const stage = $('#lumina-camera-stage');
  if (stage) stage.hidden = true;

  const photoButton = $('#lumina-take-photo');
  const recordButton = $('#lumina-record-video');
  const switchButton = $('#lumina-switch-camera');
  const stopButton = $('#lumina-stop-camera');

  if (photoButton) photoButton.disabled = true;
  if (recordButton) recordButton.disabled = true;
  if (switchButton) switchButton.disabled = true;
  if (stopButton) stopButton.hidden = true;

  recording = false;

  if (recordButton) {
    recordButton.classList.remove('recording');
    recordButton.innerHTML =
      '<i class="fa-solid fa-video"></i><span>Grabar video</span>';
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus(
      'Tu navegador no permite abrir la cámara aquí. Usa HTTPS o localhost.',
      'error'
    );
    return;
  }

  stopCamera();
  setCameraStatus('Solicitando permiso para usar la cámara…');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: cameraFacingMode,
        width: { ideal: 1080 },
        height: { ideal: 1920 }
      }
    });

    const cameraVideo = $('#lumina-camera-video');
    const stage = $('#lumina-camera-stage');

    cameraVideo.srcObject = cameraStream;
    stage.hidden = false;

    await cameraVideo.play();
    applyPreviewFilter();

    $('#lumina-take-photo').disabled = false;
    $('#lumina-record-video').disabled = !window.MediaRecorder;
    $('#lumina-switch-camera').disabled = false;
    $('#lumina-stop-camera').hidden = false;

    setCameraStatus(
      'Cámara activa. Puedes tomar una foto o grabar un video.',
      'success'
    );
  } catch (error) {
    console.error('Lumina: error al abrir cámara:', error);
    stopCamera();

    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      setCameraStatus(
        'Permite el acceso a la cámara y al micrófono en tu navegador.',
        'error'
      );
    } else if (error.name === 'NotFoundError') {
      setCameraStatus('No se encontró una cámara disponible.', 'error');
    } else {
      setCameraStatus(
        `No se pudo abrir la cámara: ${error.message || 'error desconocido'}`,
        'error'
      );
    }
  }
}

function useCapturedFile(blob, type, extension) {
  if (!blob || blob.size === 0) {
    setCameraStatus('No se pudo generar el archivo.', 'error');
    return;
  }

  if (blob.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    setCameraStatus('El archivo supera el límite de 100 MB.', 'error');
    return;
  }

  resetPreviewUrl();

  selectedType = type;
  selectedFile = new File(
    [blob],
    `lumina_${Date.now()}.${extension}`,
    { type: blob.type }
  );

  selectedAudioFile = null;
  selectedFilter = 'normal';

  if (fileInput) fileInput.value = '';
  if (audioInput) audioInput.value = '';

  previewObjectUrl = URL.createObjectURL(selectedFile);

  const fileInfo = $('#file-info');
  if (fileInfo) {
    fileInfo.textContent =
      `${selectedFile.name} · ${formatBytes(selectedFile.size)}`;
  }

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === type);
  });

  $$('.filter-tag').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === 'normal');
  });

  applyFileAccept();
  renderPreview();
  updatePublishButton();
  stopCamera();

  setCameraStatus(
    type === 'image'
      ? 'Foto lista. Puedes aplicar un filtro y publicarla.'
      : 'Video listo. Puedes publicarlo desde Lumina.',
    'success'
  );
}

function takePhoto() {
  const cameraVideo = $('#lumina-camera-video');

  if (!cameraStream || !cameraVideo?.videoWidth) {
    setCameraStatus('Espera a que la cámara esté lista.', 'error');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    setCameraStatus('No se pudo procesar la foto.', 'error');
    return;
  }

  context.drawImage(
    cameraVideo,
    0,
    0,
    canvas.width,
    canvas.height
  );

  canvas.toBlob(blob => {
    if (blob) {
      useCapturedFile(blob, 'image', 'jpg');
    } else {
      setCameraStatus('No se pudo guardar la foto.', 'error');
    }
  }, 'image/jpeg', 0.92);
}

function toggleRecording() {
  const recordButton = $('#lumina-record-video');

  if (recording && mediaRecorder) {
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    return;
  }

  if (!cameraStream) {
    setCameraStatus('Abre la cámara antes de grabar.', 'error');
    return;
  }

  if (!window.MediaRecorder) {
    setCameraStatus('Tu navegador no admite grabación de video.', 'error');
    return;
  }

  const supportedTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];

  const mimeType = supportedTypes.find(type =>
    MediaRecorder.isTypeSupported(type)
  );

  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(cameraStream, { mimeType })
      : new MediaRecorder(cameraStream);

    recordedChunks = [];

    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data?.size) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener('stop', () => {
      const actualType = mediaRecorder.mimeType || 'video/webm';
      const extension = actualType.includes('mp4') ? 'mp4' : 'webm';

      const blob = new Blob(recordedChunks, { type: actualType });

      recording = false;

      if (recordButton) {
        recordButton.classList.remove('recording');
        recordButton.innerHTML =
          '<i class="fa-solid fa-video"></i><span>Grabar video</span>';
      }

      if (blob.size > 0) {
        useCapturedFile(blob, 'video', extension);
      } else {
        setCameraStatus('La grabación no produjo ningún archivo.', 'error');
      }
    }, { once: true });

    mediaRecorder.start(1000);
    recording = true;

    recordButton.classList.add('recording');
    recordButton.innerHTML =
      '<i class="fa-solid fa-stop"></i><span>Detener grabación</span>';

    setCameraStatus(
      'Grabando video. Pulsa de nuevo para detenerlo.',
      'success'
    );
  } catch (error) {
    console.error('Lumina: error al grabar:', error);
    setCameraStatus('No se pudo iniciar la grabación.', 'error');
  }
}

async function switchCamera() {
  cameraFacingMode =
    cameraFacingMode === 'environment' ? 'user' : 'environment';

  await openCamera();
}

/* =========================================================
   FILTROS
   ========================================================= */

function configureFilters() {
  $$('.filter-tag').forEach(button => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.filter === selectedFilter)
    );

    button.addEventListener('click', () => {
      const filter = button.dataset.filter || 'normal';

      selectedFilter = FILTER_CLASSES[filter] !== undefined
        ? filter
        : 'normal';

      $$('.filter-tag').forEach(tag => {
        const active = tag.dataset.filter === selectedFilter;
        tag.classList.toggle('active', active);
        tag.setAttribute('aria-pressed', String(active));
      });

      applyPreviewFilter();
    });
  });
}

/* =========================================================
   EVENTOS GENERALES
   ========================================================= */

function configureEvents() {
  $('#open-upload-btn')?.addEventListener('click', openComposer);
  $('#cancel-btn')?.addEventListener('click', closeComposer);
  publishBtn?.addEventListener('click', publishPost);

  fileInput?.addEventListener('change', onMainFileChange);

  audioInput?.addEventListener('change', () => {
    selectedAudioFile = audioInput.files?.[0] || null;

    const audioInfo = $('#audio-info');

    if (audioInfo) {
      audioInfo.textContent = selectedAudioFile
        ? `Audio adicional: ${selectedAudioFile.name} · ${formatBytes(selectedAudioFile.size)}`
        : '';
    }
  });

  $$('.media-type').forEach(button => {
    button.addEventListener('click', () => {
      setSelectedType(button.dataset.type);
    });
  });

  captionInput?.addEventListener('input', () => {
    const counter = $('#caption-counter');
    if (counter) {
      counter.textContent = `${captionInput.value.length}/150`;
    }
  });

  const searchPanel = $('#search-panel');

  $('#search-toggle')?.addEventListener('click', () => {
    if (!searchPanel) return;

    searchPanel.hidden = !searchPanel.hidden;

    if (!searchPanel.hidden) searchInput?.focus();
  });

  $('#clear-search')?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';

    renderFilteredPosts();
    searchInput?.focus();
  });

  searchInput?.addEventListener('input', renderFilteredPosts);

  $$('.top-tabs button').forEach(button => {
    button.addEventListener('click', () => {
      $$('.top-tabs button').forEach(tab => {
        tab.classList.toggle('active', tab === button);
      });

      renderFilteredPosts();
    });
  });

  $('#close-comments-btn')?.addEventListener('click', closeComments);
  commentForm?.addEventListener('submit', submitComment);

  [previewModal, commentsModal].filter(Boolean).forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;

      if (modal === previewModal) {
        closeComposer();
      } else {
        closeComments();
      }
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;

    if (commentsModal && !commentsModal.hidden) {
      closeComments();
    } else if (previewModal && !previewModal.hidden) {
      closeComposer();
    }
  });

  // Si el modal se oculta por otro código, apaga la cámara.
  if (previewModal) {
    new MutationObserver(() => {
      if (previewModal.hidden) stopCamera();
    }).observe(previewModal, {
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  // Si la página pasa a segundo plano, evita audio inesperado.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAllFeedMedia();
    } else {
      const visiblePost = activePostElement;

      if (visiblePost?.isConnected) {
        activatePost(visiblePost);
      }
    }
  });
}

/* =========================================================
   INICIO
   ========================================================= */

function initializeLumina() {
  configureEvents();
  configureFilters();
  buildCameraInterface();
  configureCircularFeed();

  resetComposer();
  loadPosts();

  console.info('Lumina: aplicación inicializada.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLumina, {
    once: true
  });
} else {
  initializeLumina();
}
'use strict';

/* =========================================================
   LUMINA — SCRIPT PRINCIPAL OPTIMIZADO
   Supabase · Feed · Multimedia · Cámara · Filtros
   ========================================================= */

/* -------------------- CONFIGURACIÓN -------------------- */

const SUPABASE_URL =
  'https://crmlyayzknjojjnsxpej.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_ywTHI-07EYSo5-ZH5Lyifw_U28_vM77';

const MEDIA_BUCKET = 'fotos';
const AUDIO_BUCKET = 'audio';
const MAX_FILE_SIZE_MB = 100;

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    )
  : null;

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

const feed = $('#feed');
const feedStatus = $('#feed-status');
const fileInput = $('#file-input');
const audioInput = $('#audio-input');
const previewModal = $('#preview-modal');
const previewContainer = $('#preview-container');
const captionInput = $('#caption-input');
const hashtagsInput = $('#hashtags-input');
const publishBtn = $('#publish-btn');
const commentsModal = $('#comments-modal');
const commentsList = $('#comments-list');
const newCommentInput = $('#new-comment-input');
const commentForm = $('#comment-form');
const searchInput = $('#search-input');

let selectedFile = null;
let selectedAudioFile = null;
let selectedType = 'image';
let selectedFilter = 'normal';
let activePostForComments = null;
let allPosts = [];
let previewObjectUrl = null;
let isPublishing = false;

let activePostElement = null;
let postObserver = null;
let feedMutationObserver = null;
let feedLoopLocked = false;
let feedLoopTimer = null;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let cameraFacingMode = 'environment';
let recording = false;

/*
 * Preferencia global de sonido:
 * false = intentar reproducir con sonido.
 * true  = mantener los videos silenciados.
 *
 * Si el navegador bloquea el sonido automático,
 * se intentará reproducir el video silenciado.
 */
let userMutedVideos = false;

const likedPosts = new Set();

const TYPE_ACCEPT = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file: '.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.csv'
};

const FILTER_CLASSES = {
  normal: '',
  vintage: 'filter-vintage',
  cyber: 'filter-cyber',
  bw: 'filter-bw'
};

/* -------------------- UTILIDADES -------------------- */

function showToast(message, isError = false) {
  const container = $('#toast-container');

  if (!container) {
    console[isError ? 'error' : 'log'](message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3500);
}

function setFeedStatus(message = '') {
  if (feedStatus) feedStatus.textContent = message;
}

function formatCount(value) {
  const number = Number(value) || 0;

  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1).replace('.0', '')} M`;
  }

  if (number >= 1000) {
    return `${(number / 1000).toFixed(1).replace('.0', '')} mil`;
  }

  return String(number);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name) {
  return String(name || 'archivo')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-100) || 'archivo';
}

function getPostId(post) {
  return post?.id == null ? '' : String(post.id);
}

function createElement(tag, className = '', text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function showMediaError(container, message) {
  if (!container || $('.media-error-message', container)) return;

  container.appendChild(
    createElement('p', 'media-error-message', message)
  );
}

function resetPreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = null;
}

function getStoragePublicUrl(bucket, path) {
  if (!supabaseClient || !path) return '';

  const cleanPath = String(path).replace(/^\/+/, '');

  return supabaseClient.storage
    .from(bucket)
    .getPublicUrl(cleanPath)?.data?.publicUrl || '';
}

function resolveMediaUrl(value, bucket = MEDIA_BUCKET) {
  if (!value) return '';

  const url = String(value).trim();

  if (/^(https?:\/\/|blob:|data:)/i.test(url)) {
    return url;
  }

  if (url.startsWith('//')) {
    return `${location.protocol}${url}`;
  }

  return getStoragePublicUrl(
    bucket,
    url.replace(/^\/+/, '')
  );
}

function fileMatchesType(file, type) {
  if (!file) return false;

  if (type === 'image') return file.type.startsWith('image/');
  if (type === 'video') return file.type.startsWith('video/');
  if (type === 'audio') return file.type.startsWith('audio/');

  if (type === 'file') {
    return !/^(image|video|audio)\//i.test(file.type);
  }

  return false;
}

function applyFileAccept() {
  if (fileInput) {
    fileInput.accept = TYPE_ACCEPT[selectedType] || '*/*';
  }
}

function filterFromPost(post) {
  const value = String(post.filter || '')
    .replace(/^filter-/, '');

  return FILTER_CLASSES[value] !== undefined
    ? FILTER_CLASSES[value]
    : '';
}

function checkSupabase() {
  if (!window.supabase?.createClient) {
    setFeedStatus(
      'No se encontró la biblioteca de Supabase. Revisa index.html.'
    );
    return false;
  }

  if (
    !SUPABASE_URL.startsWith('https://') ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes('PEGA_AQUI')
  ) {
    setFeedStatus('Configura la URL y la clave publicable de Supabase.');
    return false;
  }

  if (!supabaseClient) {
    setFeedStatus('No se pudo inicializar Supabase.');
    return false;
  }

  return true;
}

/* =========================================================
   COMPOSITOR: PUBLICAR CONTENIDO
   ========================================================= */

function resetComposer() {
  stopCamera();
  resetPreviewUrl();

  selectedFile = null;
  selectedAudioFile = null;
  selectedType = 'image';
  selectedFilter = 'normal';

  if (fileInput) fileInput.value = '';
  if (audioInput) audioInput.value = '';
  if (captionInput) captionInput.value = '';
  if (hashtagsInput) hashtagsInput.value = '';

  const elements = {
    counter: $('#caption-counter'),
    fileInfo: $('#file-info'),
    audioInfo: $('#audio-info'),
    error: $('#publish-error'),
    progressContainer: $('#upload-progress-container'),
    progress: $('#upload-progress'),
    status: $('#upload-status')
  };

  if (elements.counter) elements.counter.textContent = '0/150';
  if (elements.fileInfo) {
    elements.fileInfo.textContent = 'Ningún archivo seleccionado';
  }
  if (elements.audioInfo) elements.audioInfo.textContent = '';
  if (elements.error) elements.error.textContent = '';
  if (elements.progressContainer) elements.progressContainer.hidden = true;
  if (elements.progress) elements.progress.value = 0;
  if (elements.status) elements.status.textContent = '';

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === 'image');
  });

  $$('.filter-tag').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === 'normal');
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.filter === 'normal')
    );
  });

  applyFileAccept();
  renderPreview();
  updatePublishButton();
}

function openComposer() {
  if (!previewModal) return;

  resetComposer();
  previewModal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeComposer() {
  if (isPublishing || !previewModal) return;

  previewModal.hidden = true;
  document.body.classList.remove('modal-open');
  stopCamera();
  resetComposer();
}

function setSelectedType(type) {
  selectedType = TYPE_ACCEPT[type] ? type : 'image';

  $$('.media-type').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.type === selectedType
    );
  });

  applyFileAccept();

  if (selectedFile && !fileMatchesType(selectedFile, selectedType)) {
    selectedFile = null;

    if (fileInput) fileInput.value = '';

    const info = $('#file-info');
    if (info) info.textContent = 'Elige un archivo del tipo seleccionado';

    resetPreviewUrl();
  }

  renderPreview();
  updatePublishButton();
}

function updatePublishButton() {
  if (publishBtn) {
    publishBtn.disabled = !selectedFile || isPublishing;
  }
}

function renderPreview() {
  if (!previewContainer) return;

  previewContainer.replaceChildren();

  if (!selectedFile) {
    const placeholder = createElement('div', 'preview-placeholder');
    const icon = createElement('i');
    icon.className = 'fa-regular fa-images';

    placeholder.append(
      icon,
      createElement('p', '', 'La vista previa aparecerá aquí')
    );

    previewContainer.appendChild(placeholder);
    applyPreviewFilter();
    return;
  }

  const filterClass = FILTER_CLASSES[selectedFilter] || '';

  if (selectedType === 'image') {
    const image = createElement('img');
    image.src = previewObjectUrl;
    image.alt = 'Vista previa de la imagen';
    image.className = filterClass;
    previewContainer.appendChild(image);

  } else if (selectedType === 'video') {
    const video = createElement('video');
    video.src = previewObjectUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.className = filterClass;
    previewContainer.appendChild(video);

  } else if (selectedType === 'audio') {
    const card = createElement('div', 'audio-preview-card');
    const icon = createElement('i');
    icon.className = 'fa-solid fa-music';

    const title = createElement('strong', '', selectedFile.name);
    const audio = createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = previewObjectUrl;

    card.append(icon, title, audio);
    previewContainer.appendChild(card);

  } else {
    const card = createElement('div', 'file-preview-card');
    const icon = createElement('i');
    icon.className = 'fa-solid fa-file-lines';

    card.append(
      icon,
      createElement('strong', '', selectedFile.name),
      createElement('small', '', formatBytes(selectedFile.size))
    );

    previewContainer.appendChild(card);
  }

  applyPreviewFilter();
}

function applyPreviewFilter() {
  const classes = Object.values(FILTER_CLASSES).filter(Boolean);
  const media = $('#preview-container img, #preview-container video');

  if (media) {
    media.classList.remove(...classes);

    const currentClass = FILTER_CLASSES[selectedFilter];
    if (currentClass) media.classList.add(currentClass);
  }

  const cameraVideo = $('#lumina-camera-video');

  if (cameraVideo) {
    cameraVideo.classList.remove(...classes);

    const currentClass = FILTER_CLASSES[selectedFilter];
    if (currentClass) cameraVideo.classList.add(currentClass);
  }
}

function onMainFileChange() {
  const file = fileInput?.files?.[0];
  if (!file) return;

  if (!fileMatchesType(file, selectedType)) {
    showToast('El archivo no coincide con el tipo seleccionado.', true);
    fileInput.value = '';
    return;
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`, true);
    fileInput.value = '';
    return;
  }

  resetPreviewUrl();

  selectedFile = file;
  previewObjectUrl = URL.createObjectURL(file);

  const info = $('#file-info');
  if (info) {
    info.textContent = `${file.name} · ${formatBytes(file.size)}`;
  }

  renderPreview();
  updatePublishButton();
}

/* =========================================================
   MEDIOS DE LAS PUBLICACIONES
   ========================================================= */

function createMedia(post) {
  const type = post.media_type || 'image';

  const mainUrl = resolveMediaUrl(
    post.image_url || post.media_url || post.file_url,
    MEDIA_BUCKET
  );

  const mediaWrap = createElement('div', 'post-media-wrap');

  if (!mainUrl) {
    mediaWrap.appendChild(
      createElement('div', 'media-unavailable', 'Contenido no disponible')
    );

    return { mediaWrap, mediaElement: null };
  }

  const filterClass = filterFromPost(post);

  if (type === 'video') {
    const video = createElement('video', `post-media ${filterClass}`.trim());

    video.src = mainUrl;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = true;

    /*
     * Se intenta sonido cuando la publicación se vuelve activa.
     * No forzamos muted=true aquí: eso impediría el primer intento
     * de reproducción automática con sonido.
     */
    video.muted = false;
    video.dataset.soundReady = 'false';

    const soundBtn = createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'sound-toggle';
    soundBtn.setAttribute('aria-label', 'Silenciar');
    soundBtn.setAttribute('aria-pressed', 'false');

    function updateSoundButton() {
      const muted = video.muted || video.volume === 0;

      soundBtn.innerHTML = muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';

      soundBtn.setAttribute(
        'aria-label',
        muted ? 'Activar sonido' : 'Silenciar'
      );

      soundBtn.setAttribute('aria-pressed', String(!muted));
    }

    soundBtn.addEventListener('click', async event => {
      event.stopPropagation();

      userMutedVideos = !video.muted;

      if (userMutedVideos) {
        video.muted = true;
        updateSoundButton();
        return;
      }

      video.muted = false;
      video.volume = 1;
      updateSoundButton();

      try {
        await video.play();
        video.dataset.soundReady = 'true';
      } catch {
        showToast(
          'Pulsa reproducir en el video para activar el sonido.',
          true
        );
      }
    });

    video.addEventListener('volumechange', updateSoundButton);

    video.addEventListener('play', () => {
      video.dataset.soundReady = String(!video.muted);
      updateSoundButton();
    });

    video.addEventListener('error', () => {
      showMediaError(mediaWrap, 'No se pudo cargar el video.');
    });

    updateSoundButton();
    mediaWrap.append(video, soundBtn);

    return { mediaWrap, mediaElement: video };
  }

  if (type === 'audio') {
    const card = createElement('div', 'post-audio-card');
    const art = createElement('div', 'audio-art');
    art.innerHTML = '<i class="fa-solid fa-music"></i>';

    const meta = createElement('div', 'audio-meta');
    meta.append(
      createElement(
        'strong',
        '',
        post.audio_title || post.caption || 'Pista de audio'
      ),
      createElement('small', '', 'Audio')
    );

    const audio = createElement('audio', 'post-audio-main');
    audio.src = mainUrl;
    audio.controls = true;
    audio.preload = 'metadata';

    audio.addEventListener('error', () => {
      showMediaError(card, 'No se pudo reproducir este audio.');
    });

    card.append(art, meta, audio);
    mediaWrap.appendChild(card);

    return { mediaWrap, mediaElement: audio };
  }

  if (type === 'file') {
    const link = createElement('a', 'post-file-card');
    link.href = mainUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const icon = createElement('i');
    icon.className = 'fa-solid fa-file-arrow-down';

    link.append(
      icon,
      createElement(
        'span',
        'file-name',
        post.file_name || post.caption || 'Archivo adjunto'
      ),
      createElement('small', '', 'Abrir o descargar archivo')
    );

    mediaWrap.appendChild(link);
    return { mediaWrap, mediaElement: null };
  }

  const image = createElement('img', `post-media ${filterClass}`.trim());
  image.src = mainUrl;
  image.alt = post.caption
    ? `Imagen: ${post.caption}`
    : 'Imagen de publicación';
  image.loading = 'lazy';

  image.addEventListener('error', () => {
    showMediaError(
      mediaWrap,
      'No se pudo cargar la imagen. Comprueba el acceso al bucket fotos.'
    );
  });

  mediaWrap.appendChild(image);
  return { mediaWrap, mediaElement: image };
}

/* =========================================================
   BOTONES DE ACCIÓN
   ========================================================= */

function makeAction(className, iconName, countText, label) {
  const wrapper = createElement('div', 'action-group');
  const button = createElement('button');

  button.type = 'button';
  button.className = `action-btn ${className}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="fa-solid ${iconName}"></i>`;

  const count = createElement('div', 'action-count', countText);
  wrapper.append(button, count);

  return { wrapper, button, count };
}

function toggleLike(post, group) {
  const id = getPostId(post);

  if (!id) {
    showToast('Esta publicación no tiene un identificador válido.', true);
    return;
  }

  const wasLiked = likedPosts.has(id);

  if (wasLiked) {
    likedPosts.delete(id);
  } else {
    likedPosts.add(id);
  }

  group.button.classList.toggle('liked', !wasLiked);

  const current = Math.max(
    0,
    (Number(post.likes_count) || 0) + (wasLiked ? -1 : 1)
  );

  post.likes_count = current;
  group.count.textContent = formatCount(current);

  showToast(
    wasLiked
      ? 'Me gusta quitado de esta sesión.'
      : 'Me gusta añadido en esta sesión.'
  );
}

async function loadCommentCount(postId, element) {
  if (!supabaseClient || !element) return;

  try {
    const { count, error } = await supabaseClient
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId);

    if (!error && count !== null) {
      element.textContent = formatCount(count);
    }
  } catch (error) {
    console.warn('No se pudo consultar el contador de comentarios.', error);
  }
}

/* =========================================================
   CONSTRUIR UNA PUBLICACIÓN
   ========================================================= */

function renderPost(post) {
  const postEl = createElement('article', 'post');
  postEl.dataset.postId = getPostId(post);

  const { mediaWrap } = createMedia(post);
  postEl.appendChild(mediaWrap);

  const overlay = createElement('div', 'post-overlay');
  const userInfo = createElement('div', 'user-info');
  const username = String(post.username || 'usuario');

  const avatar = createElement('img', 'avatar');
  avatar.src =
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`;
  avatar.alt = '';
  avatar.loading = 'lazy';

  const userLabel = createElement(
    'span',
    'username',
    username.startsWith('@') ? username : `@${username}`
  );

  userInfo.append(avatar, userLabel);
  overlay.appendChild(userInfo);

  const caption = createElement(
    'p',
    'caption',
    [post.caption || '', post.hashtags || '']
      .filter(Boolean)
      .join(' ')
  );

  overlay.appendChild(caption);

  if (post.audio_url) {
    const audioLabel = createElement('p', 'audio-info');
    const icon = createElement('i');
    icon.className = 'fa-solid fa-music';

    audioLabel.append(
      icon,
      document.createTextNode(` ${post.audio_title || 'Audio adjunto'}`)
    );

    overlay.appendChild(audioLabel);
  }

  postEl.appendChild(overlay);

  const actionBar = createElement('div', 'action-bar');

  const likeGroup = makeAction(
    'like-btn',
    'fa-heart',
    formatCount(post.likes_count || 0),
    'Me gusta'
  );

  if (likedPosts.has(getPostId(post))) {
    likeGroup.button.classList.add('liked');
  }

  likeGroup.button.addEventListener('click', event => {
    event.stopPropagation();
    toggleLike(post, likeGroup);
  });

  const commentGroup = makeAction(
    'comment-btn',
    'fa-comment-dots',
    '0',
    'Comentarios'
  );

  commentGroup.button.addEventListener('click', event => {
    event.stopPropagation();
    openCommentsModal(post);
  });

  const shareGroup = makeAction(
    'share-btn',
    'fa-share',
    'Compartir',
    'Compartir publicación'
  );

  shareGroup.button.addEventListener('click', async event => {
    event.stopPropagation();

    const url = resolveMediaUrl(
      post.image_url || post.media_url || post.file_url,
      MEDIA_BUCKET
    ) || location.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Lumina',
          text: post.caption || 'Mira esta publicación en Lumina',
          url
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast('Enlace copiado.');
      } else {
        showToast('No se pudo compartir desde este navegador.', true);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        showToast('No se pudo compartir la publicación.', true);
      }
    }
  });

  actionBar.append(
    likeGroup.wrapper,
    commentGroup.wrapper,
    shareGroup.wrapper
  );

  if (post.audio_url || post.media_type === 'audio') {
    const vinyl = createElement('div', 'vinyl-disc');
    vinyl.innerHTML = '<i class="fa-solid fa-music"></i>';
    actionBar.appendChild(vinyl);
  }

  postEl.appendChild(actionBar);

  /*
   * El audio adicional conserva sus controles manuales.
   * No se reproduce a la vez que el video automáticamente,
   * evitando mezclar dos pistas de sonido.
   */
  if (post.audio_url && post.media_type !== 'audio') {
    const audioUrl = resolveMediaUrl(post.audio_url, AUDIO_BUCKET);

    if (audioUrl) {
      const audio = createElement('audio');
      audio.src = audioUrl;
      audio.preload = 'none';
      audio.controls = true;
      audio.loop = true;
      audio.setAttribute(
        'aria-label',
        'Audio adicional de la publicación'
      );

      const dock = createElement('div', 'post-audio-dock');
      dock.appendChild(audio);
      postEl.appendChild(dock);
    }
  }

  if (supabaseClient && post.id != null) {
    loadCommentCount(post.id, commentGroup.count);
  }

  return postEl;
}

/* =========================================================
   FEED: CARGAR Y FILTRAR PUBLICACIONES
   ========================================================= */

async function loadPosts() {
  if (!feed) {
    console.error('No existe el elemento #feed en index.html.');
    return;
  }

  setFeedStatus('Cargando publicaciones…');
  stopAllFeedMedia();
  feed.replaceChildren();

  if (!checkSupabase()) return;

  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    allPosts = Array.isArray(data) ? data : [];

    console.info(`Lumina: ${allPosts.length} publicaciones recuperadas.`);

    renderFilteredPosts();
  } catch (error) {
    console.error('Error cargando publicaciones:', error);

    setFeedStatus(
      `No se pudieron cargar las publicaciones: ${
        error.message || 'revisa la conexión y los permisos de posts.'
      }`
    );
  }
}

function renderFilteredPosts() {
  if (!feed) return;

  stopAllFeedMedia();
  activePostElement = null;
  feed.replaceChildren();

  const term = (searchInput?.value || '').trim().toLowerCase();
  const activeFeed =
    $('.top-tabs button.active')?.dataset.feed || 'for-you';

  let posts = [...allPosts];

  if (term) {
    posts = posts.filter(post => {
      const searchableText = [
        post.caption || '',
        post.username || '',
        post.hashtags || '',
        post.audio_title || '',
        post.file_name || ''
      ].join(' ').toLowerCase();

      return searchableText.includes(term);
    });
  }

  if (activeFeed === 'following') {
    setFeedStatus(
      'Para activar “Siguiendo” debes configurar usuarios y relaciones de seguimiento.'
    );
    return;
  }

  if (!posts.length) {
    setFeedStatus(
      term
        ? 'No hay publicaciones que coincidan con tu búsqueda.'
        : 'Todavía no hay publicaciones. ¡Comparte la primera!'
    );
    return;
  }

  setFeedStatus('');

  const fragment = document.createDocumentFragment();

  posts.forEach(post => {
    fragment.appendChild(renderPost(post));
  });

  feed.appendChild(fragment);

  // Los resultados nuevos comienzan siempre desde la publicación más reciente.
  feed.scrollTop = 0;

  observeFeedPosts();
}

/* =========================================================
   REPRODUCCIÓN INTELIGENTE Y AUDIO AUTOMÁTICO
   ========================================================= */

function pauseMediaInPost(postElement, muteVideos = true) {
  if (!postElement) return;

  $$('video, audio', postElement).forEach(media => {
    try {
      media.pause();

      if (media.tagName === 'VIDEO' && muteVideos) {
        media.muted = true;
      }
    } catch (error) {
      console.warn('No se pudo pausar un medio.', error);
    }
  });
}

function stopAllFeedMedia() {
  if (!feed) return;

  $$('#feed video, #feed audio').forEach(media => {
    try {
      media.pause();

      if (media.tagName === 'VIDEO') {
        media.muted = true;
      }
    } catch {
      // Continúa con los demás medios.
    }
  });
}

async function playActiveMedia(postElement) {
  if (!postElement || postElement !== activePostElement) return;

  const video = $('video.post-media', postElement);
  const mainAudio = $('audio.post-audio-main', postElement);

  if (video) {
    /*
     * Primero intentamos sonido real.
     * Si el navegador lo bloquea, probamos reproducción silenciada.
     */
    video.muted = userMutedVideos;

    try {
      await video.play();
      return;
    } catch (soundError) {
      if (postElement !== activePostElement) return;

      if (!userMutedVideos) {
        video.muted = true;

        try {
          await video.play();
          return;
        } catch (mutedError) {
          console.info(
            'El navegador requiere interacción para reproducir el video.',
            mutedError
          );
        }
      } else {
        console.info('El navegador bloqueó la reproducción automática.', soundError);
      }
    }

    return;
  }

  /*
   * En una publicación de audio se intenta reproducir su pista
   * principal cuando la publicación entra en pantalla.
   */
  if (mainAudio) {
    try {
      await mainAudio.play();
    } catch (error) {
      console.info(
        'Pulsa reproducir para escuchar esta publicación.',
        error
      );
    }
  }
}

function activatePost(postElement) {
  if (!postElement || postElement === activePostElement) return;

  // Corta el sonido anterior antes de iniciar el nuevo contenido.
  stopAllFeedMedia();

  activePostElement = postElement;

  // Solo el contenido de la publicación activa puede reproducirse.
  playActiveMedia(postElement);
}

function observeFeedPosts() {
  if (!feed || !('IntersectionObserver' in window)) {
    if (feed) {
      const firstPost = $('.post', feed);
      if (firstPost) activatePost(firstPost);
    }
    return;
  }

  if (!postObserver) {
    const visibleRatios = new Map();

    postObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        visibleRatios.set(
          entry.target,
          entry.isIntersecting ? entry.intersectionRatio : 0
        );
      });

      let bestPost = null;
      let bestRatio = 0;

      for (const [element, ratio] of visibleRatios) {
        if (!element.isConnected) {
          visibleRatios.delete(element);
          continue;
        }

        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestPost = element;
        }
      }

      if (bestPost && bestRatio >= 0.55) {
        activatePost(bestPost);
      }
    }, {
      root: feed,
      threshold: [0, 0.25, 0.4, 0.55, 0.7, 0.85, 1]
    });

    postObserver._visibleRatios = visibleRatios;
  }

  const observerRatios = postObserver._visibleRatios;

  $$('.post', feed).forEach(post => {
    if (post.dataset.observed === 'true') return;

    post.dataset.observed = 'true';
    postObserver.observe(post);
  });

  // Elimina referencias a publicaciones que ya no existen.
  for (const element of observerRatios.keys()) {
    if (!element.isConnected) {
      postObserver.unobserve(element);
      observerRatios.delete(element);
    }
  }
}

/* =========================================================
   FEED CIRCULAR: ÚLTIMA PUBLICACIÓN → MÁS RECIENTE
   ========================================================= */

function returnToNewestPost() {
  if (!feed || feedLoopLocked) return;

  const posts = $$('.post', feed);
  if (posts.length < 2) return;

  feedLoopLocked = true;

  // Se detiene el sonido antes de regresar al principio.
  stopAllFeedMedia();

  feed.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  window.clearTimeout(feedLoopTimer);

  feedLoopTimer = window.setTimeout(() => {
    feedLoopLocked = false;

    const firstPost = $('.post', feed);
    if (firstPost) activatePost(firstPost);
  }, 850);
}

function configureCircularFeed() {
  if (!feed || feed.dataset.circularFeedReady === 'true') return;

  feed.dataset.circularFeedReady = 'true';

  let scrollFramePending = false;

  feed.addEventListener('scroll', () => {
    if (scrollFramePending || feedLoopLocked) return;

    scrollFramePending = true;

    window.requestAnimationFrame(() => {
      scrollFramePending = false;

      const posts = $$('.post', feed);
      if (posts.length < 2) return;

      const remaining =
        feed.scrollHeight - feed.scrollTop - feed.clientHeight;

      // Activa el retorno al llegar al final del feed.
      if (remaining <= 8) {
        returnToNewestPost();
      }
    });
  }, { passive: true });
}

/* =========================================================
   COMENTARIOS
   ========================================================= */

async function openCommentsModal(post) {
  if (!post || post.id == null) {
    showToast('Esta publicación no tiene un identificador válido.', true);
    return;
  }

  if (!commentsModal || !commentsList) return;

  activePostForComments = post.id;
  commentsModal.hidden = false;
  document.body.classList.add('modal-open');
  commentsList.replaceChildren();

  const loading = createElement(
    'p',
    'empty-comments',
    'Cargando comentarios…'
  );

  commentsList.appendChild(loading);

  if (!supabaseClient) {
    loading.textContent = 'No hay conexión con Supabase.';
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('*')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw error;

    commentsList.replaceChildren();

    if (!data?.length) {
      commentsList.appendChild(
        createElement('p', 'empty-comments', 'Sé el primero en comentar.')
      );
      return;
    }

    data.forEach(comment => {
      const item = createElement('div', 'comment-item');
      const username = String(comment.username || 'usuario')
        .replace(/^@/, '');

      item.append(
        createElement('strong', '', `@${username}: `),
        createElement('span', '', comment.content || '')
      );

      commentsList.appendChild(item);
    });
  } catch (error) {
    commentsList.replaceChildren();

    commentsList.appendChild(
      createElement(
        'p',
        'empty-comments',
        `No se pudieron cargar los comentarios: ${
          error.message || 'error de conexión'
        }`
      )
    );
  }
}

async function submitComment(event) {
  event.preventDefault();

  const content = newCommentInput?.value.trim();

  if (!content || activePostForComments == null || !supabaseClient) {
    return;
  }

  const button = $('#send-comment-btn');
  if (button) button.disabled = true;

  try {
    const { error } = await supabaseClient
      .from('comments')
      .insert([{
        post_id: activePostForComments,
        content
      }]);

    if (error) throw error;

    newCommentInput.value = '';

    const post = allPosts.find(
      item => String(item.id) === String(activePostForComments)
    );

    if (post) await openCommentsModal(post);

    showToast('Comentario publicado.');
  } catch (error) {
    showToast(
      `No se pudo publicar el comentario: ${
        error.message || 'revisa los permisos de comments.'
      }`,
      true
    );
  } finally {
    if (button) button.disabled = false;
  }
}

function closeComments() {
  if (commentsModal) commentsModal.hidden = true;

  document.body.classList.remove('modal-open');
  activePostForComments = null;
}

/* =========================================================
   STORAGE: SUBIR ARCHIVOS
   ========================================================= */

async function uploadToBucket(bucket, file, prefix) {
  const uniqueId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const path =
    `${prefix}/${Date.now()}_${uniqueId}_${safeFileName(file.name)}`;

  const { error } = await supabaseClient.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });

  if (error) throw error;

  return {
    path,
    url: getStoragePublicUrl(bucket, path),
    bucket
  };
}

/* =========================================================
   PUBLICAR CONTENIDO
   ========================================================= */

async function publishPost() {
  if (isPublishing || !selectedFile) return;

  const publishError = $('#publish-error');

  if (!checkSupabase()) {
    if (publishError) {
      publishError.textContent =
        'Supabase no está disponible. No se ha publicado nada.';
    }
    return;
  }

  const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;

  if (selectedFile.size > maxBytes) {
    if (publishError) {
      publishError.textContent = 'El archivo supera el límite de 100 MB.';
    }
    return;
  }

  if (selectedAudioFile && selectedAudioFile.size > maxBytes) {
    if (publishError) {
      publishError.textContent =
        'El audio adicional supera el límite de 100 MB.';
    }
    return;
  }

  isPublishing = true;

  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.textContent = 'Publicando…';
  }

  if (publishError) publishError.textContent = '';

  const progressContainer = $('#upload-progress-container');
  const progress = $('#upload-progress');
  const uploadStatus = $('#upload-status');

  if (progressContainer) progressContainer.hidden = false;
  if (progress) progress.value = 10;
  if (uploadStatus) {
    uploadStatus.textContent = 'Subiendo archivo principal…';
  }

  try {
    const mainUpload = await uploadToBucket(
      MEDIA_BUCKET,
      selectedFile,
      selectedType
    );

    if (progress) progress.value = 50;

    let extraAudioUpload = null;

    if (selectedAudioFile) {
      if (uploadStatus) {
        uploadStatus.textContent = 'Subiendo audio adicional…';
      }

      extraAudioUpload = await uploadToBucket(
        AUDIO_BUCKET,
        selectedAudioFile,
        'audio'
      );
    }

    if (progress) progress.value = 75;
    if (uploadStatus) uploadStatus.textContent = 'Guardando publicación…';

    const row = {
      image_url: mainUpload.url,
      media_type: selectedType,
      caption: captionInput?.value.trim() || '',
      filter: selectedFilter === 'normal'
        ? ''
        : `filter-${selectedFilter}`,
      audio_url: extraAudioUpload?.url || null,
      audio_title: extraAudioUpload
        ? selectedAudioFile.name
        : (selectedType === 'audio' ? selectedFile.name : null)
    };

    const hashtags = hashtagsInput?.value.trim() || '';

    if (hashtags) row.hashtags = hashtags;
    if (selectedType === 'file') row.file_name = selectedFile.name;

    let { error } = await supabaseClient
      .from('posts')
      .insert([row]);

    // Compatibilidad con tablas que aún no tienen estas columnas.
    if (error && /hashtags|file_name/i.test(error.message || '')) {
      const retryRow = { ...row };
      delete retryRow.hashtags;
      delete retryRow.file_name;

      const retry = await supabaseClient
        .from('posts')
        .insert([retryRow]);

      error = retry.error;
    }

    if (error) throw error;

    if (progress) progress.value = 100;
    if (uploadStatus) uploadStatus.textContent = '¡Publicación guardada!';

    if (previewModal) previewModal.hidden = true;

    document.body.classList.remove('modal-open');
    stopCamera();
    resetComposer();

    await loadPosts();

    showToast('Publicación compartida.');
  } catch (error) {
    console.error('Error publicando:', error);

    if (publishError) {
      publishError.textContent =
        `No se pudo publicar: ${
          error.message || 'error desconocido'
        }. Revisa los permisos y las columnas de Supabase.`;
    }
  } finally {
    isPublishing = false;
    updatePublishButton();

    if (publishBtn) publishBtn.textContent = 'Publicar';
  }
}

/* =========================================================
   CÁMARA: TOMAR FOTOS Y GRABAR VIDEOS
   ========================================================= */

function buildCameraInterface() {
  const composerCard = $('#preview-modal .modal-card');
  if (!composerCard || !previewContainer) return;

  // Evita insertar la cámara más de una vez.
  if ($('#lumina-camera-section')) return;

  const cameraSection = createElement('section', 'camera-section');
  cameraSection.id = 'lumina-camera-section';

  cameraSection.innerHTML = `
    <div class="camera-tools">
      <button type="button" id="lumina-open-camera">
        <i class="fa-solid fa-camera"></i>
        <span>Abrir cámara</span>
      </button>

      <button type="button" id="lumina-take-photo" disabled>
        <i class="fa-solid fa-camera-retro"></i>
        <span>Tomar foto</span>
      </button>

      <button type="button" id="lumina-record-video" disabled>
        <i class="fa-solid fa-video"></i>
        <span>Grabar video</span>
      </button>
    </div>

    <div class="camera-stage" id="lumina-camera-stage" hidden>
      <video
        id="lumina-camera-video"
        autoplay
        muted
        playsinline
      ></video>
    </div>

    <div class="camera-controls">
      <button type="button" class="camera-control-btn"
        id="lumina-switch-camera" disabled>
        <i class="fa-solid fa-camera-rotate"></i>
        Cambiar cámara
      </button>

      <button type="button" class="camera-control-btn"
        id="lumina-stop-camera" hidden>
        <i class="fa-solid fa-stop"></i>
        Cerrar cámara
      </button>
    </div>

    <p class="camera-status" id="lumina-camera-status" aria-live="polite">
      Puedes tomar una foto o grabar un video.
    </p>
  `;

  const mediaSelector = composerCard.querySelector('.media-type-selector');

  if (mediaSelector) {
    mediaSelector.insertAdjacentElement('afterend', cameraSection);
  } else {
    previewContainer.insertAdjacentElement('beforebegin', cameraSection);
  }

  $('#lumina-open-camera')?.addEventListener('click', openCamera);
  $('#lumina-take-photo')?.addEventListener('click', takePhoto);
  $('#lumina-record-video')?.addEventListener('click', toggleRecording);
  $('#lumina-switch-camera')?.addEventListener('click', switchCamera);

  $('#lumina-stop-camera')?.addEventListener('click', () => {
    stopCamera();
    setCameraStatus('Cámara cerrada.');
  });
}

function setCameraStatus(message, type = '') {
  const status = $('#lumina-camera-status');
  if (!status) return;

  status.textContent = message;
  status.className = `camera-status ${type}`.trim();
}

function stopCamera() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch (error) {
      console.warn('No se pudo detener la grabación.', error);
    }
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  cameraStream = null;

  const cameraVideo = $('#lumina-camera-video');
  if (cameraVideo) cameraVideo.srcObject = null;

  const stage = $('#lumina-camera-stage');
  if (stage) stage.hidden = true;

  const photoButton = $('#lumina-take-photo');
  const recordButton = $('#lumina-record-video');
  const switchButton = $('#lumina-switch-camera');
  const stopButton = $('#lumina-stop-camera');

  if (photoButton) photoButton.disabled = true;
  if (recordButton) recordButton.disabled = true;
  if (switchButton) switchButton.disabled = true;
  if (stopButton) stopButton.hidden = true;

  recording = false;

  if (recordButton) {
    recordButton.classList.remove('recording');
    recordButton.innerHTML =
      '<i class="fa-solid fa-video"></i><span>Grabar video</span>';
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus(
      'Tu navegador no permite abrir la cámara aquí. Usa HTTPS o localhost.',
      'error'
    );
    return;
  }

  stopCamera();
  setCameraStatus('Solicitando permiso para usar la cámara…');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: cameraFacingMode,
        width: { ideal: 1080 },
        height: { ideal: 1920 }
      }
    });

    const cameraVideo = $('#lumina-camera-video');
    const stage = $('#lumina-camera-stage');

    cameraVideo.srcObject = cameraStream;
    stage.hidden = false;

    await cameraVideo.play();
    applyPreviewFilter();

    $('#lumina-take-photo').disabled = false;
    $('#lumina-record-video').disabled = !window.MediaRecorder;
    $('#lumina-switch-camera').disabled = false;
    $('#lumina-stop-camera').hidden = false;

    setCameraStatus(
      'Cámara activa. Puedes tomar una foto o grabar un video.',
      'success'
    );
  } catch (error) {
    console.error('Lumina: error al abrir cámara:', error);
    stopCamera();

    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      setCameraStatus(
        'Permite el acceso a la cámara y al micrófono en tu navegador.',
        'error'
      );
    } else if (error.name === 'NotFoundError') {
      setCameraStatus('No se encontró una cámara disponible.', 'error');
    } else {
      setCameraStatus(
        `No se pudo abrir la cámara: ${error.message || 'error desconocido'}`,
        'error'
      );
    }
  }
}

function useCapturedFile(blob, type, extension) {
  if (!blob || blob.size === 0) {
    setCameraStatus('No se pudo generar el archivo.', 'error');
    return;
  }

  if (blob.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    setCameraStatus('El archivo supera el límite de 100 MB.', 'error');
    return;
  }

  resetPreviewUrl();

  selectedType = type;
  selectedFile = new File(
    [blob],
    `lumina_${Date.now()}.${extension}`,
    { type: blob.type }
  );

  selectedAudioFile = null;
  selectedFilter = 'normal';

  if (fileInput) fileInput.value = '';
  if (audioInput) audioInput.value = '';

  previewObjectUrl = URL.createObjectURL(selectedFile);

  const fileInfo = $('#file-info');
  if (fileInfo) {
    fileInfo.textContent =
      `${selectedFile.name} · ${formatBytes(selectedFile.size)}`;
  }

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === type);
  });

  $$('.filter-tag').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === 'normal');
  });

  applyFileAccept();
  renderPreview();
  updatePublishButton();
  stopCamera();

  setCameraStatus(
    type === 'image'
      ? 'Foto lista. Puedes aplicar un filtro y publicarla.'
      : 'Video listo. Puedes publicarlo desde Lumina.',
    'success'
  );
}

function takePhoto() {
  const cameraVideo = $('#lumina-camera-video');

  if (!cameraStream || !cameraVideo?.videoWidth) {
    setCameraStatus('Espera a que la cámara esté lista.', 'error');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    setCameraStatus('No se pudo procesar la foto.', 'error');
    return;
  }

  context.drawImage(
    cameraVideo,
    0,
    0,
    canvas.width,
    canvas.height
  );

  canvas.toBlob(blob => {
    if (blob) {
      useCapturedFile(blob, 'image', 'jpg');
    } else {
      setCameraStatus('No se pudo guardar la foto.', 'error');
    }
  }, 'image/jpeg', 0.92);
}

function toggleRecording() {
  const recordButton = $('#lumina-record-video');

  if (recording && mediaRecorder) {
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    return;
  }

  if (!cameraStream) {
    setCameraStatus('Abre la cámara antes de grabar.', 'error');
    return;
  }

  if (!window.MediaRecorder) {
    setCameraStatus('Tu navegador no admite grabación de video.', 'error');
    return;
  }

  const supportedTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];

  const mimeType = supportedTypes.find(type =>
    MediaRecorder.isTypeSupported(type)
  );

  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(cameraStream, { mimeType })
      : new MediaRecorder(cameraStream);

    recordedChunks = [];

    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data?.size) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener('stop', () => {
      const actualType = mediaRecorder.mimeType || 'video/webm';
      const extension = actualType.includes('mp4') ? 'mp4' : 'webm';

      const blob = new Blob(recordedChunks, { type: actualType });

      recording = false;

      if (recordButton) {
        recordButton.classList.remove('recording');
        recordButton.innerHTML =
          '<i class="fa-solid fa-video"></i><span>Grabar video</span>';
      }

      if (blob.size > 0) {
        useCapturedFile(blob, 'video', extension);
      } else {
        setCameraStatus('La grabación no produjo ningún archivo.', 'error');
      }
    }, { once: true });

    mediaRecorder.start(1000);
    recording = true;

    recordButton.classList.add('recording');
    recordButton.innerHTML =
      '<i class="fa-solid fa-stop"></i><span>Detener grabación</span>';

    setCameraStatus(
      'Grabando video. Pulsa de nuevo para detenerlo.',
      'success'
    );
  } catch (error) {
    console.error('Lumina: error al grabar:', error);
    setCameraStatus('No se pudo iniciar la grabación.', 'error');
  }
}

async function switchCamera() {
  cameraFacingMode =
    cameraFacingMode === 'environment' ? 'user' : 'environment';

  await openCamera();
}

/* =========================================================
   FILTROS
   ========================================================= */

function configureFilters() {
  $$('.filter-tag').forEach(button => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.filter === selectedFilter)
    );

    button.addEventListener('click', () => {
      const filter = button.dataset.filter || 'normal';

      selectedFilter = FILTER_CLASSES[filter] !== undefined
        ? filter
        : 'normal';

      $$('.filter-tag').forEach(tag => {
        const active = tag.dataset.filter === selectedFilter;
        tag.classList.toggle('active', active);
        tag.setAttribute('aria-pressed', String(active));
      });

      applyPreviewFilter();
    });
  });
}

/* =========================================================
   EVENTOS GENERALES
   ========================================================= */

function configureEvents() {
  $('#open-upload-btn')?.addEventListener('click', openComposer);
  $('#cancel-btn')?.addEventListener('click', closeComposer);
  publishBtn?.addEventListener('click', publishPost);

  fileInput?.addEventListener('change', onMainFileChange);

  audioInput?.addEventListener('change', () => {
    selectedAudioFile = audioInput.files?.[0] || null;

    const audioInfo = $('#audio-info');

    if (audioInfo) {
      audioInfo.textContent = selectedAudioFile
        ? `Audio adicional: ${selectedAudioFile.name} · ${formatBytes(selectedAudioFile.size)}`
        : '';
    }
  });

  $$('.media-type').forEach(button => {
    button.addEventListener('click', () => {
      setSelectedType(button.dataset.type);
    });
  });

  captionInput?.addEventListener('input', () => {
    const counter = $('#caption-counter');
    if (counter) {
      counter.textContent = `${captionInput.value.length}/150`;
    }
  });

  const searchPanel = $('#search-panel');

  $('#search-toggle')?.addEventListener('click', () => {
    if (!searchPanel) return;

    searchPanel.hidden = !searchPanel.hidden;

    if (!searchPanel.hidden) searchInput?.focus();
  });

  $('#clear-search')?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';

    renderFilteredPosts();
    searchInput?.focus();
  });

  searchInput?.addEventListener('input', renderFilteredPosts);

  $$('.top-tabs button').forEach(button => {
    button.addEventListener('click', () => {
      $$('.top-tabs button').forEach(tab => {
        tab.classList.toggle('active', tab === button);
      });

      renderFilteredPosts();
    });
  });

  $('#close-comments-btn')?.addEventListener('click', closeComments);
  commentForm?.addEventListener('submit', submitComment);

  [previewModal, commentsModal].filter(Boolean).forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;

      if (modal === previewModal) {
        closeComposer();
      } else {
        closeComments();
      }
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;

    if (commentsModal && !commentsModal.hidden) {
      closeComments();
    } else if (previewModal && !previewModal.hidden) {
      closeComposer();
    }
  });

  // Si el modal se oculta por otro código, apaga la cámara.
  if (previewModal) {
    new MutationObserver(() => {
      if (previewModal.hidden) stopCamera();
    }).observe(previewModal, {
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  // Si la página pasa a segundo plano, evita audio inesperado.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAllFeedMedia();
    } else {
      const visiblePost = activePostElement;

      if (visiblePost?.isConnected) {
        activatePost(visiblePost);
      }
    }
  });
}

/* =========================================================
   INICIO
   ========================================================= */

function initializeLumina() {
  configureEvents();
  configureFilters();
  buildCameraInterface();
  configureCircularFeed();

  resetComposer();
  loadPosts();

  console.info('Lumina: aplicación inicializada.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLumina, {
    once: true
  });
} else {
  initializeLumina();
                        }
