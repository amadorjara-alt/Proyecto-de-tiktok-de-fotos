// ============================================
// LUMINA — Lógica principal
// ============================================

const SUPABASE_URL = 'https://crmlyayzknjojjnsxpej.supabase.co';
const SUPABASE_ANON_KEY = 'PEGA_AQUI_TU_CLAVE_ANON_ACTUAL';

const MEDIA_BUCKET = 'fotos';
const AUDIO_BUCKET = 'audio';
const MAX_FILE_SIZE_MB = 100;

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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
  if (!container) return;

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

  if (number >= 1000) {
    return `${(number / 1000).toFixed(1).replace('.0', '')} mil`;
  }

  return String(number);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name) {
  return name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-100) || 'archivo';
}

function getPostId(post) {
  return post?.id == null ? '' : String(post.id);
}

function publicUrl(bucket, path) {
  const result = supabaseClient.storage.from(bucket).getPublicUrl(path);
  return result?.data?.publicUrl || '';
}

function resetPreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = null;
}

function applyFileAccept() {
  fileInput.accept = TYPE_ACCEPT[selectedType] || '*/*';
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

// ============================================
// VENTANA PARA PUBLICAR
// ============================================

function resetComposer() {
  resetPreviewUrl();

  selectedFile = null;
  selectedAudioFile = null;
  selectedType = 'image';
  selectedFilter = 'normal';

  fileInput.value = '';
  audioInput.value = '';
  captionInput.value = '';
  hashtagsInput.value = '';

  $('#caption-counter').textContent = '0/150';
  $('#file-info').textContent = 'Ningún archivo seleccionado';
  $('#audio-info').textContent = '';
  $('#publish-error').textContent = '';
  $('#upload-progress-container').hidden = true;
  $('#upload-progress').value = 0;
  $('#upload-status').textContent = '';

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === 'image');
  });

  $$('.filter-tag').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === 'normal');
  });

  applyFileAccept();
  renderPreview();

  publishBtn.disabled = true;
  publishBtn.textContent = 'Publicar';
}

function openComposer() {
  resetComposer();
  previewModal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeComposer() {
  if (isPublishing) return;

  previewModal.hidden = true;
  document.body.classList.remove('modal-open');
  resetComposer();
}

function setSelectedType(type) {
  selectedType = TYPE_ACCEPT[type] ? type : 'image';

  $$('.media-type').forEach(button => {
    button.classList.toggle('active', button.dataset.type === selectedType);
  });

  applyFileAccept();

  if (selectedFile && !fileMatchesType(selectedFile, selectedType)) {
    selectedFile = null;
    fileInput.value = '';
    $('#file-info').textContent = 'Elige un archivo del tipo seleccionado';
  }

  renderPreview();
  updatePublishButton();
}

function updatePublishButton() {
  publishBtn.disabled = !selectedFile || isPublishing;
}

// ============================================
// VISTA PREVIA DE LOS ARCHIVOS
// ============================================

function renderPreview() {
  previewContainer.replaceChildren();

  if (!selectedFile) {
    const placeholder = document.createElement('div');
    placeholder.className = 'preview-placeholder';
    placeholder.innerHTML =
      '<i class="fa-regular fa-images"></i><p>La vista previa aparecerá aquí</p>';

    previewContainer.appendChild(placeholder);
    return;
  }

  const filterClass = FILTER_CLASSES[selectedFilter];

  if (selectedType === 'image') {
    const img = document.createElement('img');
    img.alt = 'Vista previa de la imagen';
    img.src = previewObjectUrl;
    img.className = filterClass;
    previewContainer.appendChild(img);

  } else if (selectedType === 'video') {
    const video = document.createElement('video');
    video.src = previewObjectUrl;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.className = filterClass;
    previewContainer.appendChild(video);

  } else if (selectedType === 'audio') {
    const card = document.createElement('div');
    card.className = 'audio-preview-card';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-music';

    const title = document.createElement('strong');
    title.textContent = selectedFile.name;

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = previewObjectUrl;

    card.append(icon, title, audio);
    previewContainer.appendChild(card);

  } else {
    const card = document.createElement('div');
    card.className = 'file-preview-card';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-file-lines';

    const title = document.createElement('strong');
    title.textContent = selectedFile.name;

    const size = document.createElement('small');
    size.textContent = formatBytes(selectedFile.size);

    card.append(icon, title, size);
    previewContainer.appendChild(card);
  }
}

function onMainFileChange() {
  const file = fileInput.files?.[0];
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

  $('#file-info').textContent =
    `${file.name} · ${formatBytes(file.size)}`;

  renderPreview();
  updatePublishButton();
}

// ============================================
// MEDIOS DE LAS PUBLICACIONES
// ============================================

function filterFromPost(post) {
  const value = String(post.filter || '').replace(/^filter-/, '');
  return FILTER_CLASSES[value] !== undefined
    ? FILTER_CLASSES[value]
    : '';
}

function showMediaError(container, message) {
  if ($('.media-error-message', container)) return;

  const error = document.createElement('p');
  error.className = 'media-error-message';
  error.textContent = message;

  container.appendChild(error);
}

function createMedia(post) {
  const url = post.image_url || post.media_url || post.file_url || '';
  const type = post.media_type || 'image';
  const filter = filterFromPost(post);

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'post-media-wrap';

  if (!url) {
    const error = document.createElement('div');
    error.className = 'media-unavailable';
    error.textContent = 'Contenido no disponible';
    mediaWrap.appendChild(error);

    return { mediaWrap, mediaElement: null };
  }

  // VIDEO
  if (type === 'video') {
    const video = document.createElement('video');

    video.className = `post-media ${filter}`;
    video.src = url;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.controls = true;
    video.muted = true;

    video.addEventListener('error', () => {
      showMediaError(mediaWrap, 'No se pudo cargar el video.');
    });

    mediaWrap.appendChild(video);

    const soundBtn = document.createElement('button');
    soundBtn.type = 'button';
    soundBtn.className = 'sound-toggle';
    soundBtn.setAttribute('aria-label', 'Activar sonido');
    soundBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';

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
          showToast('Pulsa reproducir en el video para escucharlo.', true);
        });
      }
    });

    mediaWrap.appendChild(soundBtn);

    return { mediaWrap, mediaElement: video };
  }

  // AUDIO COMO PUBLICACIÓN PRINCIPAL
  if (type === 'audio') {
    const card = document.createElement('div');
    card.className = 'post-audio-card';

    const art = document.createElement('div');
    art.className = 'audio-art';
    art.innerHTML = '<i class="fa-solid fa-music"></i>';

    const meta = document.createElement('div');
    meta.className = 'audio-meta';

    const title = document.createElement('strong');
    title.textContent = post.audio_title || post.caption || 'Pista de audio';

    const subtitle = document.createElement('small');
    subtitle.textContent = 'Audio';

    meta.append(title, subtitle);

    const audio = document.createElement('audio');
    audio.className = 'post-audio-main';
    audio.src = url;
    audio.controls = true;
    audio.preload = 'metadata';

    audio.addEventListener('error', () => {
      showMediaError(card, 'No se pudo reproducir este audio.');
    });

    card.append(art, meta, audio);
    mediaWrap.appendChild(card);

    return { mediaWrap, mediaElement: audio };
  }

  // DOCUMENTOS Y OTROS ARCHIVOS
  if (type === 'file') {
    const link = document.createElement('a');

    link.className = 'post-file-card';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-file-arrow-down';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = post.file_name || post.caption || 'Archivo adjunto';

    const help = document.createElement('small');
    help.textContent = 'Abrir o descargar archivo';

    link.append(icon, name, help);
    mediaWrap.appendChild(link);

    return { mediaWrap, mediaElement: null };
  }

  // IMAGEN
  const img = document.createElement('img');

  img.className = `post-media ${filter}`;
  img.src = url;
  img.alt = post.caption ? `Imagen: ${post.caption}` : 'Imagen de publicación';
  img.loading = 'lazy';

  img.addEventListener('error', () => {
    showMediaError(mediaWrap, 'No se pudo cargar la imagen.');
  });

  mediaWrap.appendChild(img);

  return { mediaWrap, mediaElement: img };
}

// ============================================
// BOTONES DE ACCIÓN
// ============================================

function makeAction(className, iconName, countText, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'action-group';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-btn ${className}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="fa-solid ${iconName}"></i>`;

  const count = document.createElement('div');
  count.className = 'action-count';
  count.textContent = countText;

  wrapper.append(button, count);

  return { wrapper, button, count };
}

async function toggleLike(post, group) {
  const id = getPostId(post);

  if (!id) {
    showToast('Esta publicación no tiene un identificador válido.', true);
    return;
  }

  // El estado se guarda solo durante esta sesión.
  // Para likes permanentes hace falta una tabla de likes y, preferiblemente,
  // autenticación de usuarios.
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
    console.warn('No se pudo consultar el contador de comentarios.');
  }
}

// ============================================
// DIBUJAR PUBLICACIONES
// ============================================

function renderPost(post) {
  const postEl = document.createElement('article');
  postEl.className = 'post';
  postEl.dataset.postId = getPostId(post);

  const { mediaWrap } = createMedia(post);
  postEl.appendChild(mediaWrap);

  const overlay = document.createElement('div');
  overlay.className = 'post-overlay';

  const userInfo = document.createElement('div');
  userInfo.className = 'user-info';

  const avatar = document.createElement('img');
  avatar.className = 'avatar';

  const username = post.username || 'usuario';
  avatar.src =
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}`;
  avatar.alt = '';
  avatar.loading = 'lazy';

  const userLabel = document.createElement('span');
  userLabel.className = 'username';
  userLabel.textContent = username.startsWith('@')
    ? username
    : `@${username}`;

  userInfo.append(avatar, userLabel);
  overlay.appendChild(userInfo);

  const caption = document.createElement('p');
  caption.className = 'caption';
  caption.textContent = [
    post.caption || '',
    post.hashtags || ''
  ].filter(Boolean).join(' ');

  overlay.appendChild(caption);

  if (post.audio_url) {
    const audioLabel = document.createElement('p');
    audioLabel.className = 'audio-info';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-music';

    audioLabel.append(
      icon,
      document.createTextNode(` ${post.audio_title || 'Audio adjunto'}`)
    );

    overlay.appendChild(audioLabel);
  }

  postEl.appendChild(overlay);

  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar';

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

    const url =
      post.image_url || post.media_url || post.file_url || location.href;

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
    const vinyl = document.createElement('div');
    vinyl.className = 'vinyl-disc';
    vinyl.innerHTML = '<i class="fa-solid fa-music"></i>';
    actionBar.appendChild(vinyl);
  }

  postEl.appendChild(actionBar);

  // Audio extra para una foto o un video.
  if (post.audio_url && post.media_type !== 'audio') {
    const audio = document.createElement('audio');
    audio.src = post.audio_url;
    audio.preload = 'none';
    audio.controls = true;
    audio.loop = true;
    audio.setAttribute('aria-label', 'Audio adicional de la publicación');

    const dock = document.createElement('div');
    dock.className = 'post-audio-dock';
    dock.appendChild(audio);

    postEl.appendChild(dock);
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
  setFeedStatus('Cargando publicaciones…');

  $$('.post', feed).forEach(post => post.remove());

  if (!supabaseClient) {
    setFeedStatus('Supabase no está disponible. Revisa tu configuración.');
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    allPosts = data || [];
    renderFilteredPosts();

  } catch (error) {
    console.error('Error cargando publicaciones:', error);

    setFeedStatus(
      `No se pudieron cargar las publicaciones: ${error.message || 'revisa la tabla posts y sus permisos.'}`
    );
  }
}

function renderFilteredPosts() {
  $$('.post', feed).forEach(post => post.remove());

  const term = (searchInput?.value || '').trim().toLowerCase();
  const activeFeed = $('.top-tabs button.active')?.dataset.feed || 'for-you';

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

  activePostForComments = post.id;

  commentsModal.hidden = false;
  document.body.classList.add('modal-open');
  commentsList.replaceChildren();

  const loading = document.createElement('p');
  loading.className = 'empty-comments';
  loading.textContent = 'Cargando comentarios…';
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
      const empty = document.createElement('p');
      empty.className = 'empty-comments';
      empty.textContent = 'Sé el primero en comentar.';
      commentsList.appendChild(empty);
      return;
    }

    data.forEach(comment => {
      const item = document.createElement('div');
      item.className = 'comment-item';

      const author = document.createElement('strong');
      const username = comment.username || 'usuario';
      author.textContent = `@${username.replace(/^@/, '')}: `;

      const content = document.createElement('span');
      content.textContent = comment.content || '';

      item.append(author, content);
      commentsList.appendChild(item);
    });

  } catch (error) {
    commentsList.replaceChildren();

    const message = document.createElement('p');
    message.className = 'empty-comments';
    message.textContent =
      `No se pudieron cargar los comentarios: ${error.message || 'error de conexión'}`;

    commentsList.appendChild(message);
  }
}

async function submitComment(event) {
  event.preventDefault();

  const content = newCommentInput.value.trim();

  if (!content || activePostForComments == null || !supabaseClient) {
    return;
  }

  const button = $('#send-comment-btn');
  button.disabled = true;

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

    if (post) {
      await openCommentsModal(post);
    }

    await loadPosts();
    showToast('Comentario publicado.');

  } catch (error) {
    showToast(
      `No se pudo publicar el comentario: ${error.message || 'revisa los permisos de comments.'}`,
      true
    );
  } finally {
    button.disabled = false;
  }
}

function closeComments() {
  commentsModal.hidden = true;
  document.body.classList.remove('modal-open');
  activePostForComments = null;
}

// ============================================
// SUBIR ARCHIVOS A SUPABASE STORAGE
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
    url: publicUrl(bucket, path),
    bucket
  };
}

// ============================================
// PUBLICAR
// ============================================

async function publishPost() {
  if (isPublishing || !selectedFile) return;

  if (!supabaseClient) {
    $('#publish-error').textContent =
      'Supabase no está disponible. No se ha publicado nada.';
    return;
  }

  if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    $('#publish-error').textContent =
      `El archivo supera el límite de ${MAX_FILE_SIZE_MB} MB.`;
    return;
  }

  if (
    selectedAudioFile &&
    selectedAudioFile.size > MAX_FILE_SIZE_MB * 1024 * 1024
  ) {
    $('#publish-error').textContent =
      `El audio adicional supera el límite de ${MAX_FILE_SIZE_MB} MB.`;
    return;
  }

  isPublishing = true;
  publishBtn.disabled = true;
  publishBtn.textContent = 'Publicando…';

  $('#publish-error').textContent = '';
  $('#upload-progress-container').hidden = false;
  $('#upload-progress').value = 10;
  $('#upload-status').textContent = 'Subiendo archivo principal…';

  try {
    const mainUpload = await uploadToBucket(
      MEDIA_BUCKET,
      selectedFile,
      selectedType
    );

    $('#upload-progress').value = 50;

    let extraAudioUpload = null;

    if (selectedAudioFile) {
      $('#upload-status').textContent = 'Subiendo audio adicional…';

      extraAudioUpload = await uploadToBucket(
        AUDIO_BUCKET,
        selectedAudioFile,
        'audio'
      );
    }

    $('#upload-progress').value = 75;
    $('#upload-status').textContent = 'Guardando publicación…';

    const caption = captionInput.value.trim();
    const hashtags = hashtagsInput.value.trim();

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

    // Estos campos son opcionales en la tabla.
    // Si aún no existen, se pueden añadir en Supabase.
    if (hashtags) row.hashtags = hashtags;
    if (selectedType === 'file') row.file_name = selectedFile.name;

    let { error } = await supabaseClient
      .from('posts')
      .insert([row]);

    // Compatibilidad con tablas que aún no tengan hashtags/file_name.
    if (error && /hashtags|file_name/i.test(error.message || '')) {
      delete row.hashtags;
      delete row.file_name;

      const retry = await supabaseClient
        .from('posts')
        .insert([row]);

      error = retry.error;
    }

    if (error) throw error;

    $('#upload-progress').value = 100;
    $('#upload-status').textContent = '¡Publicación guardada!';

    previewModal.hidden = true;
    document.body.classList.remove('modal-open');

    resetComposer();
    await loadPosts();

    showToast('Publicación compartida.');

  } catch (error) {
    console.error('Error publicando:', error);

    $('#publish-error').textContent =
      `No se pudo publicar: ${error.message || 'error desconocido'}. Revisa los buckets, permisos y columnas de posts.`;

  } finally {
    isPublishing = false;
    publishBtn.disabled = !selectedFile;
    publishBtn.textContent = 'Publicar';
  }
}

// ============================================
// REPRODUCCIÓN AUTOMÁTICA DE VIDEOS
// ============================================

function observeVideos() {
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const video = entry.target;

      if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
        // El video se reproduce inicialmente silenciado.
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, {
    threshold: [0, 0.65, 1]
  });

  const feedObserver = new MutationObserver(() => {
    $$('#feed video.post-media').forEach(video => {
      if (video.dataset.observed) return;

      video.dataset.observed = 'true';
      observer.observe(video);
    });
  });

  feedObserver.observe(feed, {
    childList: true,
    subtree: true
  });
}

// ============================================
// EVENTOS
// ============================================

function configureEvents() {
  $('#open-upload-btn').addEventListener('click', openComposer);
  $('#cancel-btn').addEventListener('click', closeComposer);
  publishBtn.addEventListener('click', publishPost);

  fileInput.addEventListener('change', onMainFileChange);

  audioInput.addEventListener('change', () => {
    selectedAudioFile = audioInput.files?.[0] || null;

    $('#audio-info').textContent = selectedAudioFile
      ? `Audio adicional: ${selectedAudioFile.name} · ${formatBytes(selectedAudioFile.size)}`
      : '';
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

  captionInput.addEventListener('input', () => {
    $('#caption-counter').textContent =
      `${captionInput.value.length}/150`;
  });

  $('#search-toggle').addEventListener('click', () => {
    const panel = $('#search-panel');
    panel.hidden = !panel.hidden;

    if (!panel.hidden) searchInput.focus();
  });

  $('#clear-search').addEventListener('click', () => {
    searchInput.value = '';
    renderFilteredPosts();
    searchInput.focus();
  });

  searchInput.addEventListener('input', renderFilteredPosts);

  $$('.top-tabs button').forEach(button => {
    button.addEventListener('click', () => {
      $$('.top-tabs button').forEach(tab => {
        tab.classList.toggle('active', tab === button);
      });

      renderFilteredPosts();
    });
  });

  $('#close-comments-btn').addEventListener('click', closeComments);
  commentForm.addEventListener('submit', submitComment);

  [previewModal, commentsModal].forEach(modal => {
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

    if (!commentsModal.hidden) {
      closeComments();
    } else if (!previewModal.hidden) {
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
