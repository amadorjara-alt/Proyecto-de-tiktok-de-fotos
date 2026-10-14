const SUPABASE_URL = 'https://crmlyayzknjojjnsxpej.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybWx5YXl6a25qb2pqbnN4cGVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTIxNzEsImV4cCI6MjEwNzU4ODE3MX0.1hUcv0_yj6DoeUORovO3SSPpyCC3k1JFby1XQILn1KM';

const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Elementos DOM
const feed = document.getElementById('feed');
const fileInput = document.getElementById('file-input');
const audioInput = document.getElementById('audio-input');
const previewModal = document.getElementById('preview-modal');
const previewContainer = document.getElementById('preview-container');
const captionInput = document.getElementById('caption-input');
const cancelBtn = document.getElementById('cancel-btn');
const publishBtn = document.getElementById('publish-btn');
const filterTags = document.querySelectorAll('.filter-tag');

// Elementos Comentarios
const commentsModal = document.getElementById('comments-modal');
const commentsList = document.getElementById('comments-list');
const closeCommentsBtn = document.getElementById('close-comments-btn');
const newCommentInput = document.getElementById('new-comment-input');
const sendCommentBtn = document.getElementById('send-comment-btn');

let selectedFile = null;
let selectedAudioFile = null;
let selectedFilter = 'normal';
let activePostForComments = null;

// 1. CARGAR PUBLICACIONES REALES DESDE SUPABASE
async function loadPosts() {
  feed.innerHTML = '';
  if (!supabaseClient) return;

  try {
    const { data, error } = await supabaseClient
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      data.forEach(post => renderPost(post));
    }
  } catch (err) {
    console.error('Error al cargar publicaciones:', err);
  }
}

// 2. RENDERIZAR TARJETA INDIVIDUAL (FOTO O VIDEO)
function renderPost(post) {
  const postEl = document.createElement('div');
  postEl.className = 'post';

  const isVideo = post.media_type === 'video';
  const mediaHtml = isVideo
    ? `<video class="post-media ${post.filter || ''}" src="${post.image_url}" loop playsinline autoplay muted></video>`
    : `<img class="post-media ${post.filter || ''}" src="${post.image_url}" alt="Foto">`;

  const audioHtml = post.audio_url 
    ? `<audio class="post-audio" src="${post.audio_url}" loop></audio>` 
    : '';

  const username = post.username || '@creador_' + Math.floor(Math.random() * 90 + 10);

  postEl.innerHTML = `
    ${mediaHtml}
    ${audioHtml}

    <div class="post-overlay">
      <div class="user-info">
        <img class="avatar" src="https://api.dicebear.com/7.x/bottts/svg?seed=${username}" alt="Avatar">
        <span class="username">${username}</span>
      </div>
      <p class="caption">${post.caption || ''}</p>
      ${post.audio_title ? `<p class="audio-info"><i class="fa-solid fa-music"></i> \${post.audio_title}</p>` : ''}
    </div>

    <div class="action-bar">
      <div>
        <button class="action-btn like-btn">
          <i class="fa-solid fa-heart"></i>
        </button>
        <div class="action-count count-likes">${post.likes_count || 0}</div>
      </div>

      <div>
        <button class="action-btn comment-btn">
          <i class="fa-solid fa-comment-dots"></i>
        </button>
        <div class="action-count count-comments">0</div>
      </div>

      <div>
        <button class="action-btn share-btn">
          <i class="fa-solid fa-paper-plane"></i>
        </button>
        <div class="action-count">Compartir</div>
      </div>

      <div class="vinyl-disc ${post.audio_url ? 'spinning' : ''}">
        <i class="fa-solid fa-compact-disc"></i>
      </div>
    </div>
  `;

  // Reproducción táctil para video y audio
  const mediaEl = postEl.querySelector('.post-media');
  const audioElement = postEl.querySelector('.post-audio');

  postEl.addEventListener('click', () => {
    if (isVideo) {
      mediaEl.paused ? mediaEl.play() : mediaEl.pause();
    }
    if (audioElement) {
      audioElement.paused ? audioElement.play() : audioElement.pause();
    }
  });

  // Me gusta persistente en Supabase
  const likeBtn = postEl.querySelector('.like-btn');
  const countLikes = postEl.querySelector('.count-likes');
  let isLiked = false;

  likeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    isLiked = !isLiked;
    likeBtn.classList.toggle('liked', isLiked);

    let current = parseInt(countLikes.textContent) || 0;
    const newCount = isLiked ? current + 1 : Math.max(0, current - 1);
    countLikes.textContent = newCount;

    await supabaseClient
      .from('posts')
      .update({ likes_count: newCount })
      .eq('id', post.id);
  });

  // Cargar comentarios
  const commentBtn = postEl.querySelector('.comment-btn');
  const countComments = postEl.querySelector('.count-comments');

  loadCommentCount(post.id, countComments);

  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCommentsModal(post.id);
  });

  feed.appendChild(postEl);
}

// 3. GESTIÓN DE COMENTARIOS
async function loadCommentCount(postId, element) {
  const { count } = await supabaseClient
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  element.textContent = count || 0;
}

async function openCommentsModal(postId) {
  activePostForComments = postId;
  commentsModal.classList.add('active');
  commentsList.innerHTML = '<p class="no-comments">Cargando comentarios...</p>';

  const { data } = await supabaseClient
    .from('comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  commentsList.innerHTML = '';
  if (data && data.length > 0) {
    data.forEach(c => {
      const item = document.createElement('div');
      item.className = 'comment-item';
      item.innerHTML = `<strong>@usuario:</strong> ${c.content}`;
      commentsList.appendChild(item);
    });
  } else {
    commentsList.innerHTML = '<p class="no-comments">Aún no hay comentarios. ¡Sé el primero!</p>';
  }
}

sendCommentBtn.addEventListener('click', async () => {
  const text = newCommentInput.value.trim();
  if (!text || !activePostForComments) return;

  await supabaseClient.from('comments').insert([
    { post_id: activePostForComments, content: text }
  ]);

  newCommentInput.value = '';
  openCommentsModal(activePostForComments);
  loadPosts();
});

closeCommentsBtn.addEventListener('click', () => {
  commentsModal.classList.remove('active');
  activePostForComments = null;
});

// 4. PREVISUALIZACIÓN MULTIMEDIA (FOTO/VIDEO DE LA GALERÍA O CÁMARA)
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  selectedFile = file;
  previewContainer.innerHTML = '';

  const isVideo = file.type.startsWith('video/');
  const mediaEl = document.createElement(isVideo ? 'video' : 'img');
  mediaEl.src = URL.createObjectURL(file);
  mediaEl.id = 'preview-img';

  if (isVideo) {
    mediaEl.autoplay = true;
    mediaEl.loop = true;
    mediaEl.muted = true;
  }

  previewContainer.appendChild(mediaEl);
  previewModal.classList.add('active');
});

audioInput.addEventListener('change', (e) => {
  selectedAudioFile = e.target.files[0] || null;
});

// Filtros
filterTags.forEach(tag => {
  tag.addEventListener('click', () => {
    filterTags.forEach(t => t.classList.remove('active'));
    tag.classList.add('active');
    selectedFilter = tag.dataset.filter;
    const media = document.getElementById('preview-img');
    if (media) media.className = selectedFilter !== 'normal' ? `filter-${selectedFilter}` : '';
  });
});

cancelBtn.addEventListener('click', () => {
  previewModal.classList.remove('active');
  fileInput.value = '';
  audioInput.value = '';
  selectedFile = null;
  selectedAudioFile = null;
});

// 5. PUBLICAR MULTIMEDIA Y MÚSICA EN SUPABASE
publishBtn.addEventListener('click', async () => {
  if (!selectedFile || !supabaseClient) return;

  publishBtn.disabled = true;
  publishBtn.textContent = 'Subiendo...';

  try {
    const isVideo = selectedFile.type.startsWith('video/');
    const mediaExt = selectedFile.name.split('.').pop();
    const mediaName = `${Date.now()}_media.${mediaExt}`;

    // Subir a Storage Bucket 'fotos'
    const { error: mediaError } = await supabaseClient.storage
      .from('fotos')
      .upload(mediaName, selectedFile);

    if (mediaError) throw mediaError;

    const { data: mediaUrlData } = supabaseClient.storage
      .from('fotos')
      .getPublicUrl(mediaName);

    // Subir Audio Opcional
    let audioPublicUrl = null;
    if (selectedAudioFile) {
      const audioExt = selectedAudioFile.name.split('.').pop();
      const audioName = `${Date.now()}_audio.${audioExt}`;

      const { error: audioError } = await supabaseClient.storage
        .from('audio')
        .upload(audioName, selectedAudioFile);

      if (!audioError) {
        const { data: audioUrlData } = supabaseClient.storage
          .from('audio')
          .getPublicUrl(audioName);
        audioPublicUrl = audioUrlData.publicUrl;
      }
    }

    // Insertar fila en tabla 'posts'
    const { error: dbError } = await supabaseClient.from('posts').insert([
      {
        image_url: mediaUrlData.publicUrl,
        media_type: isVideo ? 'video' : 'image',
        caption: captionInput.value,
        filter: selectedFilter !== 'normal' ? `filter-${selectedFilter}` : '',
        audio_url: audioPublicUrl,
        audio_title: selectedAudioFile ? selectedAudioFile.name : 'Sonido original'
      }
    ]);

    if (dbError) throw dbError;

    captionInput.value = '';
    fileInput.value = '';
    audioInput.value = '';
    selectedFile = null;
    selectedAudioFile = null;
    previewModal.classList.remove('active');

    loadPosts();

  } catch (err) {
    alert('Error al publicar: ' + err.message);
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = 'Publicar';
  }
});

document.addEventListener('DOMContentLoaded', loadPosts);
