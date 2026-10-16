
'use strict';

// ============================================
// LUMINA — Lógica principal
// ============================================

const SUPABASE_URL =
  'https://crmlyayzknjojjnsxpej.supabase.co';

// Pega aquí tu clave PUBLICABLE sb_publishable_...
// Nunca uses una clave sb_secret_ en el navegador.
const SUPABASE_ANON_KEY = 'sb_publishable_ywTHI-07EYSo5-ZH5Lyifw_U28_vM77';

const MEDIA_BUCKET = 'fotos';
const AUDIO_BUCKET = 'audio';
const MAX_FILE_SIZE_MB = 100;

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $ = (selector, root = document) => root.querySelector(selector);
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

// ============================================
// UTILIDADES
// ============================================

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

  setTimeout(() => toast.remove(), 3500);
}

function setFeedStatus(message = '') {
  if (feedStatus) feedStatus.textContent = message;
}

function formatCount(value) {
  const number = Number(value) || 0;

  if (number >= 1000000) {
    return `${(number / 1000000).toFixed(1).replace('.0', '')} M`;
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

function getStoragePublicUrl(bucket, path) {
  if (!supabaseClient || !path) return '';

  const cleanPath = String(path).replace(/^\/+/, '');

  return supabaseClient.storage
    .from(bucket)
    .getPublicUrl(cleanPath)?.data?.publicUrl || '';
}

// Conserva las URL completas que ya están guardadas.
// Si una fila contiene una ruta relativa, intenta resolverla.
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

function resetPreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = null;
}

function applyFileAccept() {
  if (fileInput) {
    fileInput.accept = TYPE_ACCEPT[selectedType] || '*/*';
  }
}

function fileMatchesType(file, type) {
  if (!file) return false;

  if (type === 'image') return file.type.startsWith('image/');
  if (type === 'video') return file.type.startsWith('video/');
  if (type === 'audio') return file.type.startsWith('audio/');

  if (type === 'file') {
    return !file.type.startsWith('image/') &&
      !file.type.startsWith('video/') &&
      !file.type.startsWith('audio/');
  }

  return false;
}

function filterFromPost(post) {
  const value = String(post.filter || '').replace(/^filter-/, '');

  return FILTER_CLASSES[value] !== undefined
    ? FILTER_CLASSES[value]
    : '';
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function showMediaError(container, message) {
  if ($('.media-error-message', container)) return;

  container.appendChild(
    createElement('p', 'media-error-message', message)
  );
}

// ============================================
// COMPROBAR CONEXIÓN
// ============================================

function checkSupabase() {
  if (!window.supabase?.createClient) {
    setFeedStatus(
      'No se encontró la biblioteca de Supabase. Revisa index.html.'
    );
    console.error('Falta cargar la biblioteca supabase-js.');
    return false;
  }

  if (
    !SUPABASE_URL.startsWith('https://') ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes('PEGA_AQUI')
  ) {
    setFeedStatus(
      'Configura la URL y la clave publicable de Supabase.'
    );
    console.error('Falta configurar la clave publicable.');
    return false;
  }

  if (!supabaseClient) {
    setFeedStatus('No se pudo inicializar Supabase.');
    return false;
  }

  return true;
}

// ============================================
// VENTANA PARA PUBLICAR
// ============================================

function resetComposer() {
  resetPreviewUrl();

  selectedFile = null;
  selectedAudioFile = null;
  selectedType = 'image';
  selectedFilter = 'normal';

  if (fileInput) fileInput.value = '';
  if (audioInput) audioInput.value = '';
  if (captionInput) captionInput.value = '';
  if (hashtagsInput) hashtagsInput.value = '';

  const counter = $('#caption-counter');
  const fileInfo = $('#file-info');
  const audioInfo = $('#audio-info');
  const publishError = $('#publish-error');
  const progressContainer = $('#upload-progress-container');
  const progress = $('#upload-progress');
  const uploadStatus = $('#upload-status');

  if (counter) counter.textContent = '0/150';
  if (fileInfo) fileInfo.textContent = 'Ningún archivo seleccionado';
  if (audioInfo) audioInfo.textContent = '';
  if (publishError) publishError.textContent = '';
  if (progressContainer) progressContainer.hidden = true;
  if (progress) progress.value = 0;
  if (uploadStatus) uploadStatus.textContent = '';

  $$('.media-type').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.type === 'image'
    );
  });

  $$('.filter-tag').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.filter === 'normal'
    );
  });

  applyFileAccept();
  renderPreview();

  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.textContent = 'Publicar';
  }
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

    const fileInfo = $('#file-info');
    if (fileInfo) {
      fileInfo.textContent = 'Elige un archivo del tipo seleccionado';
    }

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

// ============================================
// VISTA PREVIA
// ============================================

function renderPreview() {
  if (!previewContainer) return;

  previewContainer.replaceChildren();

  if (!selectedFile) {
    const placeholder = createElement('div', 'preview-placeholder');

    const icon = createElement('i');
    icon.className = 'fa-regular fa-images';

    const message = createElement(
      'p',
      '',
      'La vista previa aparecerá aquí'
    );

    placeholder.append(icon, message);
    previewContainer.appendChild(placeholder);
    return;
  }

  const filterClass = FILTER_CLASSES[selectedFilter];

  if (selectedType === 'image') {
    const img = createElement('img');
    img.alt = 'Vista previa de la imagen';
    img.src = previewObjectUrl;
    img.className = filterClass;
    previewContainer.appendChild(img);

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

    const title = createElement('strong', '', selectedFile.name);
    const size = createElement('small', '', formatBytes(selectedFile.size));

    card.append(icon, title, size);
    previewContainer.appendChild(card);
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
    showToast(
      `El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`,
      true
    );
    fileInput.value = '';
    return;
  }

  resetPreviewUrl();

  selectedFile = file;
  previewObjectUrl = URL.createObjectURL(file);

  const fileInfo = $('#file-info');
  if (fileInfo) {
    fileInfo.textContent =
      `${file.name} · ${formatBytes(file.size)}`;
  }

  renderPreview();
  updatePublishButton();
}

// ============================================
// MEDIOS DE LAS PUBLICACIONES
// ============================================

function createMedia(post) {
  const type = post.media_type || 'image';

  // Los archivos principales se suben al bucket fotos.
  // El audio adicional se guarda en el bucket audio.
  const mainUrl = resolveMediaUrl(
    post.image_url || post.media_url || post.file_url,
    MEDIA_BUCKET
  );

  const mediaWrap = createElement('div', 'post-media-wrap');

  if (!mainUrl) {
    const unavailable = createElement(
      'div',
      'media-unavailable',
      'Contenido no disponible'
    );

    mediaWrap.appendChild(unavailable);
    return { mediaWrap, mediaElement: null };
  }

  const filter = filterFromPost(post);

  if (type === 'video') {
    const video = createElement('video');
    video.className = `post-media ${filter}`.trim();
    video.src = mainUrl;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = true;
    video.muted = true;

    video.addEventListener('error', () => {
      showMediaError(mediaWrap, 'No se pudo cargar el video.');
    });

    mediaWrap.appendChild(video);

    const soundBtn = createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'sound-toggle';
    soundBtn.setAttribute('aria-label', 'Activar sonido');
    soundBtn.innerHTML =
      '<i class="fa-solid fa-volume-xmark"></i>';

    soundBtn.addEventListener('click', event => {
      event.stopPropagation();
      video.muted = !video.muted;

      soundBtn.innerHTML = video.muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';

      soundBtn.setAttribute(
        'aria-label',
        video.muted ? 'Activar sonido' : 'Silenciar'
      );

      if (video.paused) {
        video.play().catch(() => {
          showToast(
            'Pulsa reproducir en el video para escucharlo.',
            true
          );
        });
      }
    });

    mediaWrap.appendChild(soundBtn);

    return { mediaWrap, mediaElement: video };
  }

  if (type === 'audio') {
    const card = createElement('div', 'post-audio-card');

    const art = createElement('div', 'audio-art');
    art.innerHTML = '<i class="fa-solid fa-music"></i>';

    const meta = createElement('div', 'audio-meta');

    const title = createElement(
      'strong',
      '',
      post.audio_title || post.caption || 'Pista de audio'
    );

    const subtitle = createElement('small', '', 'Audio');

    meta.append(title, subtitle);

    const audio = createElement('audio');
    audio.className = 'post-audio-main';
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
    const link = createElement('a');
    link.className = 'post-file-card';
    link.href = mainUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const icon = createElement('i');
    icon.className = 'fa-solid fa-file-arrow-down';

    const name = createElement(
      'span',
      'file-name',
      post.file_name || post.caption || 'Archivo adjunto'
    );

    const help = createElement(
      'small',
      '',
      'Abrir o descargar archivo'
    );

    link.append(icon, name, help);
    mediaWrap.appendChild(link);

    return { mediaWrap, mediaElement: null };
  }

  const img = createElement('img');
  img.className = `post-media ${filter}`.trim();
  img.src = mainUrl;
  img.alt = post.caption
    ? `Imagen: ${post.caption}`
    : 'Imagen de publicación';
  img.loading = 'lazy';

  img.addEventListener('error', () => {
    showMediaError(
      mediaWrap,
      'No se pudo cargar la imagen. Comprueba el acceso al bucket fotos.'
    );
  });

  mediaWrap.appendChild(img);

  return { mediaWrap, mediaElement: img };
}

// ============================================
// BOTONES DE ACCIÓN
// ============================================

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

// ============================================
// DIBUJAR UNA PUBLICACIÓN
// ============================================

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
      document.createTextNode(
        ` ${post.audio_title || 'Audio adjunto'}`
      )
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

  // Audio adicional de una foto o video.
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

// ============================================
// CARGAR Y BUSCAR PUBLICACIONES
// ============================================

async function loadPosts() {
  if (!feed) {
    console.error('No existe el elemento #feed en index.html.');
    return;
  }

  setFeedStatus('Cargando publicaciones…');
  $$('.post', feed).forEach(post => post.remove());

  if (!checkSupabase()) return;

  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    allPosts = Array.isArray(data) ? data : [];

    // Diagnóstico útil: no muestra las claves de Supabase.
    console.info(
      `Lumina: ${allPosts.length} publicaciones recuperadas.`
    );

    renderFilteredPosts();

  } catch (error) {
    console.error('Error cargando publicaciones:', error);

    setFeedStatus(
      `No se pudieron cargar las publicaciones: ${
        error.message || 'revisa la conexión y los permisos de la tabla posts.'
      }`
    );
  }
}

function renderFilteredPosts() {
  if (!feed) return;

  $$('.post', feed).forEach(post => post.remove());

  const term = (searchInput?.value || '').trim().toLowerCase();
  const activeFeed =
    $('.top-tabs button.active')?.dataset.feed || 'for-you';

  let posts = [...allPosts];

  if (term) {
    posts = posts.filter(post => {
      const text = [
        post.caption || '',
        post.username || '',
        post.hashtags || '',
        post.audio_title || '',
        post.file_name || ''
      ].join(' ').toLowerCase();

      return text.includes(term);
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
}

// ============================================
// COMENTARIOS
// ============================================

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
      const author = createElement('strong');
      const username = String(comment.username || 'usuario');

      author.textContent = `@${username.replace(/^@/, '')}: `;

      const content = createElement('span', '', comment.content || '');

      item.append(author, content);
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

// ============================================
// SUBIR ARCHIVOS A STORAGE
// ============================================

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

// ============================================
// PUBLICAR
// ============================================

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

  if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    if (publishError) {
      publishError.textContent =
        `El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`;
    }
    return;
  }

  if (
    selectedAudioFile &&
    selectedAudioFile.size > MAX_FILE_SIZE_MB * 1024 * 1024
  ) {
    if (publishError) {
      publishError.textContent =
        `El audio adicional supera el límite de ${MAX_FILE_SIZE_MB} MB.`;
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
  if (uploadStatus) uploadStatus.textContent = 'Subiendo archivo principal…';

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

    const caption = captionInput?.value.trim() || '';
    const hashtags = hashtagsInput?.value.trim() || '';

    const row = {
      image_url: mainUpload.url,
      media_type: selectedType,
      caption,
      filter: selectedFilter === 'normal'
        ? ''
        : `filter-${selectedFilter}`,
      audio_url: extraAudioUpload?.url || null,
      audio_title: extraAudioUpload
        ? selectedAudioFile.name
        : (selectedType === 'audio' ? selectedFile.name : null)
    };

    if (hashtags) row.hashtags = hashtags;
    if (selectedType === 'file') row.file_name = selectedFile.name;

    let { error } = await supabaseClient
      .from('posts')
      .insert([row]);

    // Compatibilidad con tablas sin columnas opcionales.
    if (error && /hashtags|file_name/i.test(error.message || '')) {
      delete row.hashtags;
      delete row.file_name;

      const retry = await supabaseClient
        .from('posts')
        .insert([row]);

      error = retry.error;
    }

    if (error) throw error;

    if (progress) progress.value = 100;
    if (uploadStatus) {
      uploadStatus.textContent = '¡Publicación guardada!';
    }

    if (previewModal) previewModal.hidden = true;
    document.body.classList.remove('modal-open');

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

// ============================================
// REPRODUCCIÓN AUTOMÁTICA DE VIDEOS
// ============================================

function observeVideos() {
  if (!('IntersectionObserver' in window) || !feed) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const video = entry.target;

      if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, {
    threshold: [0, 0.65, 1]
  });

  const observeExistingVideos = () => {
    $$('#feed video.post-media').forEach(video => {
      if (video.dataset.observed) return;

      video.dataset.observed = 'true';
      observer.observe(video);
    });
  };

  const feedObserver = new MutationObserver(observeExistingVideos);

  feedObserver.observe(feed, {
    childList: true,
    subtree: true
  });

  observeExistingVideos();
}

// ============================================
// EVENTOS
// ============================================

function configureEvents() {
  const openUploadBtn = $('#open-upload-btn');
  const cancelBtn = $('#cancel-btn');
  const searchToggle = $('#search-toggle');
  const searchPanel = $('#search-panel');
  const clearSearch = $('#clear-search');
  const closeCommentsBtn = $('#close-comments-btn');

  openUploadBtn?.addEventListener('click', openComposer);
  cancelBtn?.addEventListener('click', closeComposer);
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

  $$('.filter-tag').forEach(button => {
    button.addEventListener('click', () => {
      selectedFilter = button.dataset.filter || 'normal';

      $$('.filter-tag').forEach(tag => {
        tag.classList.toggle('active', tag === button);
      });

      const media = $('#preview-container img, #preview-container video');

      if (media) {
        media.className = FILTER_CLASSES[selectedFilter];
      }
    });
  });

  captionInput?.addEventListener('input', () => {
    const counter = $('#caption-counter');
    if (counter) {
      counter.textContent = `${captionInput.value.length}/150`;
    }
  });

  searchToggle?.addEventListener('click', () => {
    if (!searchPanel) return;

    searchPanel.hidden = !searchPanel.hidden;

    if (!searchPanel.hidden) searchInput?.focus();
  });

  clearSearch?.addEventListener('click', () => {
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

  closeCommentsBtn?.addEventListener('click', closeComments);
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
}

// ============================================
// INICIO
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  configureEvents();
  resetComposer();
  observeVideos();
  loadPosts();
});
