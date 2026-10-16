
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
}

/* -------------------- SELECCIÓN DEL TIPO -------------------- */

function setMediaType(type) {
  if (!Object.prototype.hasOwnProperty.call(TYPE_ACCEPT, type)) {
    return;
  }

  selectedType = type;
  selectedFile = null;
  applyFileAccept();

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === type);
  });

  if (fileInput) fileInput.value = '';

  const fileInfo = $('#file-info');
  if (fileInfo) fileInfo.textContent = 'Ningún archivo seleccionado';

  clearPreview();
}

/* -------------------- VISTA PREVIA -------------------- */

function clearPreview() {
  resetPreviewUrl();

  if (previewContainer) {
    previewContainer.replaceChildren();
  }
}

function renderFilePreview(file) {
  if (!previewContainer || !file) return;

  clearPreview();

  const url = URL.createObjectURL(file);
  previewObjectUrl = url;

  if (file.type.startsWith('image/')) {
    const image = createElement('img', 'preview-image');
    image.src = url;
    image.alt = 'Vista previa de la imagen';
    previewContainer.appendChild(image);
    return;
  }

  if (file.type.startsWith('video/')) {
    const video = createElement('video', 'preview-video');
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    previewContainer.appendChild(video);
    return;
  }

  if (file.type.startsWith('audio/')) {
    const audio = createElement('audio', 'preview-audio');
    audio.src = url;
    audio.controls = true;
    audio.preload = 'metadata';
    previewContainer.appendChild(audio);
    return;
  }

  const fileCard = createElement('div', 'preview-file');
  fileCard.append(
    createElement('span', 'preview-file-icon', '📄'),
    createElement('span', 'preview-file-name', file.name),
    createElement('span', 'preview-file-size', formatBytes(file.size))
  );

  previewContainer.appendChild(fileCard);
}

function handleSelectedFile(file) {
  if (!file) return;

  if (!fileMatchesType(file, selectedType)) {
    showToast(
      `El archivo seleccionado no corresponde al tipo ${selectedType}.`,
      true
    );
    return;
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(
      `El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`,
      true
    );
    return;
  }

  selectedFile = file;

  const fileInfo = $('#file-info');
  if (fileInfo) {
    fileInfo.textContent = `${file.name} · ${formatBytes(file.size)}`;
  }

  renderFilePreview(file);

  if (previewModal) {
    previewModal.hidden = false;
    previewModal.classList.add('open');
    previewModal.setAttribute('aria-hidden', 'false');
  }
}

/* -------------------- FILTROS -------------------- */

function setPreviewFilter(filterName) {
  if (!Object.prototype.hasOwnProperty.call(FILTER_CLASSES, filterName)) {
    return;
  }

  selectedFilter = filterName;

  const media = previewContainer?.querySelector('img, video');

  if (media) {
    media.classList.remove(
      ...Object.values(FILTER_CLASSES).filter(Boolean)
    );

    const filterClass = FILTER_CLASSES[filterName];
    if (filterClass) media.classList.add(filterClass);
  }

  $$('.filter-option').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.filter === filterName
    );
  });
}

/* -------------------- ETIQUETAS -------------------- */

function parseHashtags(value) {
  const matches = String(value || '').match(/#[\p{L}\p{N}_]+/gu) || [];

  return [...new Set(
    matches.map(tag => tag.toLowerCase())
  )];
}

function normalizeCaption(value) {
  return String(value || '').trim().slice(0, 150);
}

/* -------------------- SUBIDA A SUPABASE -------------------- */

function getBucketForFile(file) {
  return file?.type?.startsWith('audio/')
    ? AUDIO_BUCKET
    : MEDIA_BUCKET;
}

async function uploadFile(file) {
  if (!supabaseClient) {
    throw new Error('Supabase no está configurado.');
  }

  if (!file) {
    throw new Error('No se seleccionó ningún archivo.');
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(
      `El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`
    );
  }

  const bucket = getBucketForFile(file);
  const extension = safeFileName(file.name).split('.').pop();
  const uniqueName =
    `${Date.now()}_${crypto.randomUUID()}.${extension}`;

  const path = uniqueName;

  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });

  if (error) {
    throw new Error(`No se pudo subir el archivo: ${error.message}`);
  }

  const publicUrl = getStoragePublicUrl(bucket, data.path);

  return {
    bucket,
    path: data.path,
    url: publicUrl,
    name: file.name,
    mimeType: file.type,
    size: file.size
  };
}

/* -------------------- INDICADOR DE PROGRESO -------------------- */

function setUploadProgress(value, message = '') {
  const container = $('#upload-progress-container');
  const progress = $('#upload-progress');
  const status = $('#upload-status');

  if (container) container.hidden = false;
  if (progress) {
    progress.max = 100;
    progress.value = Math.max(0, Math.min(100, value));
  }
  if (status) status.textContent = message;
}

/* -------------------- PUBLICAR -------------------- */

async function publishPost() {
  if (isPublishing) return;

  if (!checkSupabase()) {
    showToast('No se pudo conectar con Supabase.', true);
    return;
  }

  if (!selectedFile) {
    showToast('Selecciona una imagen, video, audio o archivo.', true);
    return;
  }

  if (!fileMatchesType(selectedFile, selectedType)) {
    showToast('El archivo no coincide con el tipo elegido.', true);
    return;
  }

  const caption = normalizeCaption(captionInput?.value);

  isPublishing = true;

  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.textContent = 'Publicando…';
  }

  try {
    setUploadProgress(10, 'Preparando archivo…');

    const uploaded = await uploadFile(selectedFile);

    setUploadProgress(65, 'Guardando publicación…');

    /*
     * IMPORTANTE:
     * Esta tabla debe existir en Supabase y sus columnas deben
     * coincidir con las utilizadas aquí.
     *
     * Si tu tabla tiene otros nombres de columnas, se deben
     * ajustar según tu esquema real.
     */
    const postData = {
      caption,
      media_url: uploaded.url,
      media_type: selectedType,
      filter: selectedFilter,
      hashtags: parseHashtags(hashtagsInput?.value),
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from('posts')
      .insert(postData)
      .select()
      .single();

    if (error) {
      throw new Error(
        `Archivo subido, pero no se guardó la publicación: ${error.message}`
      );
    }

    setUploadProgress(100, '¡Publicación creada!');

    showToast('¡Tu publicación se ha compartido!');

    closePreview();
    resetComposer();

    if (data) {
      allPosts.unshift(data);
      renderFeed(allPosts);
    } else {
      await loadPosts();
    }
  } catch (error) {
    console.error('Error al publicar:', error);
    showToast(error.message || 'No se pudo publicar.', true);
  } finally {
    isPublishing = false;

    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publicar';
    }
  }
}

/* -------------------- CERRAR VISTA PREVIA -------------------- */

function closePreview() {
  if (previewModal) {
    previewModal.classList.remove('open');
    previewModal.hidden = true;
    previewModal.setAttribute('aria-hidden', 'true');
  }

  clearPreview();
}

/* =========================================================
   FEED — CARGA DE PUBLICACIONES
   ========================================================= */

async function loadPosts() {
  if (!checkSupabase()) return;

  setFeedStatus('Cargando publicaciones…');

  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    allPosts = Array.isArray(data) ? data : [];
    renderFeed(allPosts);

    setFeedStatus(
      allPosts.length
        ? ''
        : 'Todavía no hay publicaciones. ¡Sé el primero en compartir!'
    );
  } catch (error) {
    console.error('Error cargando publicaciones:', error);
    setFeedStatus('No se pudieron cargar las publicaciones.');
    showToast('Error al cargar el feed.', true);
  }
}

/* -------------------- RENDERIZADO DEL FEED -------------------- */

function renderFeed(posts) {
  if (!feed) return;

  /*
   * Detener multimedia antes de reemplazar los elementos
   * evita que queden videos o audios reproduciéndose fuera
   * del feed visible.
   */
  stopAllMedia();

  const fragment = document.createDocumentFragment();

  posts.forEach(post => {
    const element = createPostElement(post);
    if (element) fragment.appendChild(element);
  });

  feed.replaceChildren(fragment);

  activePostElement = null;
  setupFeedObserver();

  if (!posts.length) {
    setFeedStatus('No hay publicaciones para mostrar.');
  } else {
    setFeedStatus('');
  }
}

/* -------------------- CREAR TARJETA DE PUBLICACIÓN -------------------- */

function createPostElement(post) {
  if (!post) return null;

  const postElement = createElement('article', 'post');
  postElement.dataset.postId = getPostId(post);
  postElement.dataset.mediaType = post.media_type || 'image';

  const mediaContainer = createElement('div', 'post-media');

  const mediaType = String(post.media_type || 'image').toLowerCase();
  const mediaUrl = resolveMediaUrl(
    post.media_url || post.file_url || post.url || '',
    mediaType === 'audio' ? AUDIO_BUCKET : MEDIA_BUCKET
  );

  mediaContainer.dataset.mediaType = mediaType;

  if (mediaUrl) {
    if (mediaType === 'video') {
      const video = createElement('video', 'post-video');
      video.src = mediaUrl;
      video.playsInline = true;
      video.preload = 'metadata';
      video.loop = true;
      video.controls = false;
      video.setAttribute('aria-label', 'Video de la publicación');

      video.addEventListener('click', () => {
        if (video.paused) {
          playActiveMedia(postElement, video);
        } else {
          video.pause();
        }
      });

      video.addEventListener('error', () => {
        showMediaError(mediaContainer, 'No se pudo cargar este video.');
      });

      mediaContainer.appendChild(video);
    } else if (mediaType === 'audio') {
      const audioCard = createElement('div', 'post-audio-card');
      const audioIcon = createElement('div', 'audio-icon', '♫');
      const audioTitle = createElement(
        'p',
        'audio-title',
        post.caption || 'Audio compartido'
      );

      const audio = createElement('audio', 'post-audio');
      audio.src = mediaUrl;
      audio.preload = 'metadata';
      audio.controls = true;

      audio.addEventListener('play', () => {
        pauseOtherMedia(audio);
        activePostElement = postElement;
      });

      audio.addEventListener('error', () => {
        showMediaError(mediaContainer, 'No se pudo cargar este audio.');
      });

      audioCard.append(audioIcon, audioTitle, audio);
      mediaContainer.appendChild(audioCard);
    } else if (mediaType === 'image') {
      const image = createElement('img', 'post-image');
      image.src = mediaUrl;
      image.alt = post.caption || 'Imagen compartida';
      image.loading = 'lazy';
      image.decoding = 'async';

      image.addEventListener('error', () => {
        showMediaError(mediaContainer, 'No se pudo cargar esta imagen.');
      });

      const filterClass = filterFromPost(post);
      if (filterClass) image.classList.add(filterClass);

      mediaContainer.appendChild(image);
    } else {
      const fileCard = createElement('div', 'post-file-card');
      const fileIcon = createElement('span', 'post-file-icon', '📄');
      const fileName = createElement(
        'span',
        'post-file-name',
        post.file_name || post.caption || 'Archivo compartido'
      );

      const openLink = createElement('a', 'post-file-link', 'Abrir archivo');
      openLink.href = mediaUrl;
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';

      fileCard.append(fileIcon, fileName, openLink);
      mediaContainer.appendChild(fileCard);
    }
  } else {
    showMediaError(mediaContainer, 'Esta publicación no tiene una URL multimedia válida.');
  }

  const overlay = createElement('div', 'post-overlay');

  const details = createElement('div', 'post-details');
  const username = createElement(
    'p',
    'post-username',
    post.username || post.author_name || 'Usuario de Lumina'
  );

  const caption = createElement(
    'p',
    'post-caption',
    post.caption || ''
  );

  const hashtags = createElement('p', 'post-hashtags');

  const tags = Array.isArray(post.hashtags)
    ? post.hashtags
    : parseHashtags(post.caption || '');

  hashtags.textContent = tags
    .map(tag => String(tag).startsWith('#') ? tag : `#${tag}`)
    .join(' ');

  details.append(username, caption);

  if (hashtags.textContent) {
    details.appendChild(hashtags);
  }

  const actions = createElement('div', 'post-actions');

  const likeButton = createElement('button', 'post-action like-button');
  likeButton.type = 'button';
  likeButton.textContent = `♥ ${formatCount(post.likes_count || 0)}`;
  likeButton.setAttribute('aria-label', 'Me gusta');

  if (likedPosts.has(getPostId(post))) {
    likeButton.classList.add('liked');
  }

  likeButton.addEventListener('click', () => {
    toggleLike(post, likeButton);
  });

  const commentButton = createElement('button', 'post-action comment-button');
  commentButton.type = 'button';
  commentButton.textContent = `💬 ${formatCount(post.comments_count || 0)}`;
  commentButton.setAttribute('aria-label', 'Ver comentarios');

  commentButton.addEventListener('click', () => {
    openComments(post);
  });

  const shareButton = createElement('button', 'post-action share-button');
  shareButton.type = 'button';
  shareButton.textContent = '↗ Compartir';
  shareButton.setAttribute('aria-label', 'Compartir publicación');

  shareButton.addEventListener('click', () => {
    sharePost(post);
  });

  actions.append(likeButton, commentButton, shareButton);
  overlay.append(details, actions);

  postElement.append(mediaContainer, overlay);

  return postElement;
}

/* =========================================================
   MULTIMEDIA — CONTROL DE REPRODUCCIÓN
   ========================================================= */

function getAllMedia() {
  if (!feed) return [];

  return $$('.post video, .post audio', feed);
}

function stopAllMedia() {
  getAllMedia().forEach(media => {
    try {
      media.pause();
      media.currentTime = 0;
    } catch (error) {
      console.debug('No se pudo detener multimedia:', error);
    }
  });
}

function pauseOtherMedia(currentMedia) {
  getAllMedia().forEach(media => {
    if (media !== currentMedia) {
      media.pause();
    }
  });
}

/*
 * Reproduce con sonido cuando el navegador lo permite.
 * Si bloquea el autoplay con sonido, intenta modo silenciado.
 * Comprueba también que la publicación siga siendo la activa.
 */
async function playActiveMedia(postElement, media) {
  if (!postElement || !media) return;

  if (
    feedLoopLocked ||
    !postElement.isConnected ||
    !feed?.contains(postElement) ||
    postElement !== activePostElement
  ) {
    media.pause();
    return;
  }

  pauseOtherMedia(media);

  media.muted = userMutedVideos;
  media.volume = 1;

  try {
    await media.play();
  } catch (error) {
    if (
      error.name === 'NotAllowedError' &&
      !userMutedVideos
    ) {
      try {
        media.muted = true;
        await media.play();
      } catch (fallbackError) {
        console.debug(
          'El navegador bloqueó la reproducción automática:',
          fallbackError
        );
      }
    } else {
      console.debug('No se pudo iniciar el medio:', error);
    }
  }

  /*
   * Si el usuario cambió de publicación mientras play()
   * estaba pendiente, se detiene la reproducción antigua.
   */
  if (
    !postElement.isConnected ||
    postElement !== activePostElement
  ) {
    media.pause();
  }
}

/* -------------------- ACTIVAR PUBLICACIÓN VISIBLE -------------------- */

function activatePost(postElement) {
  if (
    !postElement ||
    feedLoopLocked ||
    !postElement.isConnected
  ) {
    return;
  }

  if (activePostElement === postElement) return;

  activePostElement = postElement;

  stopAllMedia();

  const media = postElement.querySelector('video');

  if (media) {
    playActiveMedia(postElement, media);
  }
}

/* -------------------- OBSERVADOR DE VISIBILIDAD -------------------- */

function setupFeedObserver() {
  if (postObserver) {
    postObserver.disconnect();
    postObserver = null;
  }

  if (!feed || !('IntersectionObserver' in window)) {
    return;
  }

  postObserver = new IntersectionObserver(entries => {
    if (feedLoopLocked) return;

    const visibleEntries = entries
      .filter(entry => entry.isIntersecting)
      .sort(
        (a, b) => b.intersectionRatio - a.intersectionRatio
      );

    if (visibleEntries.length) {
      activatePost(visibleEntries[0].target);
    }
  }, {
    root: feed,
    threshold: [0.25, 0.5, 0.75, 0.9]
  });

  $$('.post', feed).forEach(post => {
    postObserver.observe(post);
  });
}

/* =========================================================
   ME GUSTA
   ========================================================= */

async function toggleLike(post, button) {
  const postId = getPostId(post);

  if (!postId) {
    showToast('No se encontró el ID de la publicación.', true);
    return;
  }

  const wasLiked = likedPosts.has(postId);

  if (wasLiked) {
    likedPosts.delete(postId);
    button.classList.remove('liked');
  } else {
    likedPosts.add(postId);
    button.classList.add('liked');
  }

  const currentCount = Number(post.likes_count) || 0;
  const nextCount = Math.max(0, currentCount + (wasLiked ? -1 : 1));

  post.likes_count = nextCount;
  button.textContent = `♥ ${formatCount(nextCount)}`;

  /*
   * Este cambio visual funciona localmente.
   * Para guardar los likes de forma persistente se necesita
   * una tabla de likes y una política RLS adecuada.
   */
  showToast(wasLiked ? 'Quitaste tu me gusta.' : 'Te gusta esta publicación.');

  if (!supabaseClient) return;

  /*
   * No actualizamos likes_count directamente en la base de datos
   * porque eso permitiría que cualquier visitante modifique el
   * contador sin autenticación ni validación.
   */
}

/* =========================================================
   COMPARTIR PUBLICACIONES
   ========================================================= */

async function sharePost(post) {
  const postId = getPostId(post);

  const url = new URL(location.href);
  url.hash = `post-${encodeURIComponent(postId)}`;

  const shareData = {
    title: 'Publicación en Lumina',
    text: post.caption || 'Mira esta publicación en Lumina',
    url: url.toString()
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.url);
      showToast('Enlace copiado.');
    } else {
      showToast('Tu navegador no permite compartir automáticamente.', true);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Error al compartir:', error);
      showToast('No se pudo compartir la publicación.', true);
    }
  }
}

/* =========================================================
   COMENTARIOS
   ========================================================= */

function openComments(post) {
  activePostForComments = post;

  if (commentsModal) {
    commentsModal.hidden = false;
    commentsModal.classList.add('open');
    commentsModal.setAttribute('aria-hidden', 'false');
  }

  const title = $('#comments-title');

  if (title) {
    title.textContent = `Comentarios · ${post.caption || 'Publicación'}`;
  }

  loadComments(post);
}

function closeComments() {
  if (commentsModal) {
    commentsModal.classList.remove('open');
    commentsModal.hidden = true;
    commentsModal.setAttribute('aria-hidden', 'true');
  }

  activePostForComments = null;
}

async function loadComments(post) {
  if (!commentsList) return;

  commentsList.replaceChildren();

  if (!supabaseClient) {
    commentsList.appendChild(
      createElement('p', 'comments-empty', 'No hay conexión con Supabase.')
    );
    return;
  }

  const postId = getPostId(post);

  if (!postId) {
    commentsList.appendChild(
      createElement('p', 'comments-empty', 'No se encontró la publicación.')
    );
    return;
  }

  commentsList.appendChild(
    createElement('p', 'comments-loading', 'Cargando comentarios…')
  );

  try {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    commentsList.replaceChildren();

    if (!data?.length) {
      commentsList.appendChild(
        createElement('p', 'comments-empty', 'Todavía no hay comentarios.')
      );
      return;
    }

    data.forEach(comment => {
      const item = createElement('article', 'comment-item');

      const author = createElement(
        'strong',
        'comment-author',
        comment.username || comment.author_name || 'Usuario'
      );

      const body = createElement(
        'p',
        'comment-text',
        comment.content || comment.comment || ''
      );

      item.append(author, body);
      commentsList.appendChild(item);
    });
  } catch (error) {
    console.error('Error cargando comentarios:', error);

    commentsList.replaceChildren(
      createElement(
        'p',
        'comments-error',
        'No se pudieron cargar los comentarios.'
      )
    );
  }
}

async function submitComment(event) {
  event?.preventDefault();

  if (!supabaseClient || !activePostForComments) {
    showToast('No se pudo identificar la publicación.', true);
    return;
  }

  const content = String(newCommentInput?.value || '').trim();

  if (!content) {
    showToast('Escribe un comentario primero.', true);
    return;
  }

  if (content.length > 1000) {
    showToast('El comentario no puede superar los 1000 caracteres.', true);
    return;
  }

  const postId = getPostId(activePostForComments);

  try {
    const { error } = await supabaseClient
      .from('comments')
      .insert({
        post_id: postId,
        content
      });

    if (error) throw error;

    if (newCommentInput) newCommentInput.value = '';

    await loadComments(activePostForComments);

    showToast('Comentario publicado.');
  } catch (error) {
    console.error('Error publicando comentario:', error);

    showToast(
      'No se pudo publicar el comentario. Revisa las columnas y políticas RLS de comments.',
      true
    );
  }
}

/* =========================================================
   BÚSQUEDA DE PUBLICACIONES
   ========================================================= */

function searchPosts(query) {
  const normalized = String(query || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    renderFeed(allPosts);
    return;
  }

  const filtered = allPosts.filter(post => {
    const caption = String(post.caption || '').toLowerCase();
    const username = String(
      post.username || post.author_name || ''
    ).toLowerCase();

    const hashtags = Array.isArray(post.hashtags)
      ? post.hashtags.join(' ').toLowerCase()
      : '';

    return (
      caption.includes(normalized) ||
      username.includes(normalized) ||
      hashtags.includes(normalized)
    );
  });

  renderFeed(filtered);

  setFeedStatus(
    filtered.length
      ? `Se encontraron ${filtered.length} publicaciones.`
      : 'No se encontraron publicaciones.'
  );
}

/* =========================================================
   CONTROL DE SONIDO
   ========================================================= */

function toggleVideoSound() {
  userMutedVideos = !userMutedVideos;

  getAllMedia().forEach(media => {
    if (media.tagName === 'VIDEO') {
      media.muted = userMutedVideos;
    }
  });

  const soundButton = $('#sound-toggle');

  if (soundButton) {
    soundButton.textContent = userMutedVideos
      ? 'Activar sonido'
      : 'Silenciar';

    soundButton.setAttribute(
      'aria-pressed',
      String(!userMutedVideos)
    );
  }

  showToast(
    userMutedVideos
      ? 'Videos silenciados.'
      : 'Sonido activado cuando el navegador lo permite.'
  );
}

/* =========================================================
   CÁMARA — INICIALIZACIÓN Y CONTROLES
   ========================================================= */

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Tu navegador no permite acceder a la cámara.', true);
    return;
  }

  try {
    stopCamera();

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: cameraFacingMode,
        width: { ideal: 1080 },
        height: { ideal: 1920 }
      },
      audio: true
    });

    const cameraPreview = $('#camera-preview');

    if (cameraPreview) {
      cameraPreview.srcObject = cameraStream;
      cameraPreview.muted = true;
      cameraPreview.playsInline = true;

      await cameraPreview.play().catch(() => {});
    }

    const cameraModal = $('#camera-modal');

    if (cameraModal) {
      cameraModal.hidden = false;
      cameraModal.classList.add('open');
      cameraModal.setAttribute('aria-hidden', 'false');
    }
  } catch (error) {
    console.error('Error iniciando cámara:', error);

    showToast(
      'No se pudo iniciar la cámara. Comprueba los permisos y utiliza HTTPS.',
      true
    );
  }
}

function stopCamera() {
  if (mediaRecorder?.state === 'recording') {
    try {
      mediaRecorder.stop();
    } catch (error) {
      console.debug('No se pudo detener la grabación:', error);
    }
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  const cameraPreview = $('#camera-preview');

  if (cameraPreview) {
    cameraPreview.pause();
    cameraPreview.srcObject = null;
  }

  recording = false;

  const recordButton = $('#record-button');

  if (recordButton) {
    recordButton.classList.remove('recording');
    recordButton.textContent = 'Grabar';
  }
}

function closeCamera() {
  stopCamera();

  const cameraModal = $('#camera-modal');

  if (cameraModal) {
    cameraModal.classList.remove('open');
    cameraModal.hidden = true;
    cameraModal.setAttribute('aria-hidden', 'true');
  }
}

async function switchCamera() {
  cameraFacingMode =
    cameraFacingMode === 'environment'
      ? 'user'
      : 'environment';

  await startCamera();
}

/* =========================================================
   GRABACIÓN DE VIDEO
   ========================================================= */

function getSupportedVideoMimeType() {
  if (!window.MediaRecorder) return '';

  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];

  return candidates.find(type =>
    MediaRecorder.isTypeSupported(type)
  ) || '';
}

function startRecording() {
  if (!cameraStream) {
    showToast('Primero debes iniciar la cámara.', true);
    return;
  }

  if (!window.MediaRecorder) {
    showToast('Tu navegador no permite grabar video.', true);
    return;
  }

  if (mediaRecorder?.state === 'recording') return;

  recordedChunks = [];

  const mimeType = getSupportedVideoMimeType();

  try {
    mediaRecorder = new MediaRecorder(
      cameraStream,
      mimeType ? { mimeType } : undefined
    );

    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data?.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', () => {
      if (!recordedChunks.length) {
        showToast('No se generó ningún archivo de video.', true);
        return;
      }

      const finalType =
        mediaRecorder?.mimeType || 'video/webm';

      const extension = finalType.includes('mp4')
        ? 'mp4'
        : 'webm';

      const videoBlob = new Blob(recordedChunks, {
        type: finalType
      });

      const videoFile = new File(
        [videoBlob],
        `lumina_${Date.now()}.${extension}`,
        { type: finalType }
      );

      if (videoFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        showToast('El video supera el límite de 100 MB.', true);
        recordedChunks = [];
        return;
      }

      selectedType = 'video';
      selectedFile = videoFile;

      if (fileInput) {
        fileInput.accept = TYPE_ACCEPT.video;
      }

      closeCamera();
      renderFilePreview(videoFile);

      if (previewModal) {
        previewModal.hidden = false;
        previewModal.classList.add('open');
        previewModal.setAttribute('aria-hidden', 'false');
      }

      const fileInfo = $('#file-info');

      if (fileInfo) {
        fileInfo.textContent =
          `${videoFile.name} · ${formatBytes(videoFile.size)}`;
      }

      showToast('Video grabado. Ya puedes publicarlo.');
    });

    mediaRecorder.addEventListener('error', event => {
      console.error('Error de grabación:', event.error);
      showToast('Ocurrió un error al grabar.', true);
    });

    mediaRecorder.start(1000);
    recording = true;

    const recordButton = $('#record-button');

    if (recordButton) {
      recordButton.classList.add('recording');
      recordButton.textContent = 'Detener';
    }

    showToast('Grabación iniciada.');
  } catch (error) {
    console.error('No se pudo grabar:', error);
    showToast('No se pudo iniciar la grabación.', true);
  }
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
  }

  recording = false;
}

/* =========================================================
   REPRODUCCIÓN MANUAL
   ========================================================= */

async function playMediaManually(media) {
  if (!media) return;

  pauseOtherMedia(media);

  try {
    /*
     * Esta función se llama desde una acción del usuario,
     * por lo que el navegador tiene más posibilidades de
     * permitir la reproducción con sonido.
     */
    media.muted = false;
    media.volume = 1;

    await media.play();
  } catch (error) {
    console.warn('Reproducción con sonido bloqueada:', error);

    try {
      media.muted = true;
      await media.play();

      showToast(
        'El navegador bloqueó el sonido automático. El video se reprodujo silenciado.'
      );
    } catch (fallbackError) {
      console.error('Error de reproducción:', fallbackError);
      showToast('No se pudo reproducir este contenido.', true);
    }
  }
}

/* =========================================================
   LIMPIEZA AL SALIR DE LA PÁGINA
   ========================================================= */

function cleanupMedia() {
  stopAllMedia();
  stopCamera();

  if (postObserver) {
    postObserver.disconnect();
    postObserver = null;
  }

  if (feedMutationObserver) {
    feedMutationObserver.disconnect();
    feedMutationObserver = null;
  }

  if (feedLoopTimer) {
    clearTimeout(feedLoopTimer);
    feedLoopTimer = null;
  }
}

window.addEventListener('pagehide', cleanupMedia);

/* =========================================================
   FEED CIRCULAR — VOLVER AL PRINCIPIO
   ========================================================= */

function getFirstPost() {
  return feed?.querySelector('.post') || null;
}

function getLastPost() {
  const posts = $$('.post', feed);
  return posts.length ? posts[posts.length - 1] : null;
}

function scrollToFirstPost(smooth = true) {
  const firstPost = getFirstPost();

  if (!firstPost || !feed) return;

  feedLoopLocked = true;

  stopAllMedia();

  firstPost.scrollIntoView({
    behavior: smooth ? 'smooth' : 'auto',
    block: 'start'
  });

  if (feedLoopTimer) clearTimeout(feedLoopTimer);

  feedLoopTimer = setTimeout(() => {
    feedLoopLocked = false;
    feedLoopTimer = null;

    const post = getFirstPost();

    if (post) activatePost(post);
  }, smooth ? 500 : 50);
}

function setupCircularFeed() {
  if (!feed) return;

  feed.addEventListener('scroll', () => {
    if (feedLoopLocked) return;

    const posts = $$('.post', feed);

    if (!posts.length) return;

    const lastPost = posts[posts.length - 1];
    const feedRect = feed.getBoundingClientRect();
    const lastRect = lastPost.getBoundingClientRect();

    /*
     * Al llegar al final del feed, vuelve a la primera
     * publicación. Se conserva la lista original sin duplicarla.
     */
    const reachedEnd =
      lastRect.bottom <= feedRect.bottom + 5;

    if (reachedEnd) {
      scrollToFirstPost(true);
    }
  }, { passive: true });
}

/* =========================================================
   EVENTOS DE INTERFAZ
   ========================================================= */

function bindClick(selector, handler) {
  const element = $(selector);

  if (element) {
    element.addEventListener('click', handler);
  }
}

function bindEvents() {
  /* Selector de tipo de contenido */

  $$('.media-type').forEach(button => {
    button.addEventListener('click', () => {
      setMediaType(button.dataset.type);
    });
  });

  /* Selección de archivo */

  if (fileInput) {
    fileInput.addEventListener('change', event => {
      const file = event.target.files?.[0];

      if (file) handleSelectedFile(file);
    });
  }

  /* Publicación */

  bindClick('#publish-btn', publishPost);

  bindClick('#close-preview', closePreview);
  bindClick('#cancel-preview', closePreview);

  /* Filtros */

  $$('.filter-option').forEach(button => {
    button.addEventListener('click', () => {
      setPreviewFilter(button.dataset.filter);
    });
  });

  /* Texto y hashtags */

  if (captionInput) {
    captionInput.addEventListener('input', () => {
      const counter = $('#caption-counter');

      if (counter) {
        counter.textContent =
          `${captionInput.value.length}/150`;
      }
    });
  }

  /* Comentarios */

  if (commentForm) {
    commentForm.addEventListener('submit', submitComment);
  }

  bindClick('#close-comments', closeComments);
  bindClick('#comments-close', closeComments);

  /* Búsqueda */

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchPosts(searchInput.value);
    });
  }

  /* Sonido */

  bindClick('#sound-toggle', toggleVideoSound);

  /* Cámara */

  bindClick('#open-camera', startCamera);
  bindClick('#close-camera', closeCamera);
  bindClick('#switch-camera', switchCamera);

  bindClick('#record-button', () => {
    if (mediaRecorder?.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  });

  /* Feed */

  bindClick('#back-to-top', () => scrollToFirstPost(true));

  /* Audio adicional */

  if (audioInput) {
    audioInput.addEventListener('change', event => {
      const file = event.target.files?.[0];

      if (!file) return;

      if (!file.type.startsWith('audio/')) {
        showToast('Selecciona un archivo de audio válido.', true);
        audioInput.value = '';
        selectedAudioFile = null;
        return;
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        showToast('El audio supera el límite de 100 MB.', true);
        audioInput.value = '';
        selectedAudioFile = null;
        return;
      }

      selectedAudioFile = file;

      const audioInfo = $('#audio-info');

      if (audioInfo) {
        audioInfo.textContent =
          `${file.name} · ${formatBytes(file.size)}`;
      }
    });
  }

  /* Cerrar modales al pulsar fuera del contenido */

  [previewModal, commentsModal].forEach(modal => {
    if (!modal) return;

    modal.addEventListener('click', event => {
      if (event.target !== modal) return;

      if (modal === previewModal) closePreview();
      if (modal === commentsModal) closeComments();
    });
  });

  /* Evitar que el formulario recargue la página */

  const composerForm = $('#composer-form');

  if (composerForm) {
    composerForm.addEventListener('submit', event => {
      event.preventDefault();
      publishPost();
    });
  }
}

/* =========================================================
   INICIALIZACIÓN DEL FEED
   ========================================================= */

function initializeLumina() {
  if (!feed) {
    console.error(
      'No se encontró #feed. Comprueba el HTML de Lumina.'
    );
    return;
  }

  applyFileAccept();
  bindEvents();
  setupCircularFeed();

  if (checkSupabase()) {
    loadPosts();
  }

  console.info('Lumina inicializado.');
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    initializeLumina,
    { once: true }
  );
} else {
  initializeLumina();
}

/* =========================================================
   LUMINA — COMPROBACIONES Y COMPATIBILIDAD
   ========================================================= */

/* -------------------- VALIDAR CONFIGURACIÓN -------------------- */

function validateLuminaSetup() {
  const warnings = [];

  if (!feed) {
    warnings.push('No se encontró el elemento #feed.');
  }

  if (!window.supabase?.createClient) {
    warnings.push(
      'No se cargó la biblioteca de Supabase en index.html.'
    );
  }

  if (!$('#file-input')) {
    warnings.push('No se encontró el input #file-input.');
  }

  if (!$('#publish-btn')) {
    warnings.push('No se encontró el botón #publish-btn.');
  }

  warnings.forEach(warning => console.warn(`[Lumina] ${warning}`));

  return warnings;
}

/* -------------------- ACTUALIZAR PUBLICACIONES -------------------- */

async function refreshFeed() {
  await loadPosts();
}

/* -------------------- CARGA MANUAL DE UN ARCHIVO -------------------- */

function selectFileType(type) {
  setMediaType(type);
}

function selectFile(file) {
  handleSelectedFile(file);
}

/* -------------------- CERRAR TODAS LAS VISTAS -------------------- */

function closeAllModals() {
  closePreview();
  closeComments();
  closeCamera();
}

/* -------------------- TECLA ESCAPE -------------------- */

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeAllModals();
  }
});

/* -------------------- MANEJO DE ERRORES GLOBALES -------------------- */

window.addEventListener('error', event => {
  console.error(
    '[Lumina] Error de JavaScript:',
    event.message,
    event.filename,
    event.lineno
  );
});

window.addEventListener('unhandledrejection', event => {
  console.error(
    '[Lumina] Promesa rechazada:',
    event.reason
  );
});

/* -------------------- VERIFICACIÓN INICIAL -------------------- */

validateLuminaSetup();
