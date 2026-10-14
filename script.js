// 1. CONFIGURACIÓN SUPABASE
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

// Datos de demostración
const DEMO_POSTS = [
  {
    id: 'demo-1',
    image_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800',
    caption: 'Atardecer inolvidable ✨ #vibes #photo',
    username: '@carla_photo',
    likes_count: 1240,
    media_type: 'image'
  },
  {
    id: 'demo-2',
    image_url: 'https://images.unsplash.com/photo-1526772662000-3f88f10405ff?w=800',
    caption: 'Explorando nuevos rincones de la ciudad 🏙️',
    username: '@alex_travels',
    likes_count: 856,
    media_type: 'image'
  },
  {
    id: 'demo-3',
    image_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800',
    caption: 'Capturando momentos únicos 📸',
    username: '@sofia_art',
    likes_count: 2100,
    media_type: 'image'
  }
];

// 2. CARGAR PUBLICACIONES
async function loadPosts() {
  feed.innerHTML = '';
  let posts = [];

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        posts = data;
      } else {
        posts = DEMO_POSTS;
      }
    } catch (err) {
      posts = DEMO_POSTS;
    }
  } else {
    posts = DEMO_POSTS;
  }

  posts.forEach(post => renderPost(post));
}

// 3. RENDERIZAR TARJETA
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

  const username = post.username || '@usuario_' + Math.floor(Math.random() * 100);
  const likesCount = post.likes_count || post.likes || 0;

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
        <div class="action-count count-likes">${likesCount}</div>
      </div>

      <div>
        <button class="action-btn comment-btn">
          <i class="fa-solid fa-comment-dots"></i>
        </button>
        <div class="action-count count-comments">34</div>
      </div>

      <div>
        <button class="action-btn share-btn">
          <i class="fa-solid fa-paper-plane"></i>
        </button>
        <div class="action-count">Compartir</div>
      </div>

      <div class="vinyl-disc">
        <i class="fa-solid fa-music" style="font-size: 10px; color: #00f2fe;"></i>
      </div>
    </div>
  `;

  // Interacción Doble Toque o Clic para reproducir video / dar Like
  const mediaEl = postEl.querySelector('.post-media');
  const audioElement = postEl.querySelector('.post-audio');

  postEl.addEventListener('click', () => {
    if (isVideo && mediaEl) {
      mediaEl.paused ? mediaEl.play() : mediaEl.pause();
    }
    if (audioElement) {
      audioElement.paused ? audioElement.play() : audioElement.pause();
    }
  });

  // Botón Like
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

    if (supabaseClient && post.id && typeof post.id === 'string') {
      await supabaseClient
        .from('posts')
        .update({ likes_count: newCount })
        .eq('id', post.id);
    }
  });

  // Comentarios
  const commentBtn = postEl.querySelector('.comment-btn');
  const countComments = postEl.querySelector('.count-comments');

  if (supabaseClient && typeof post.id === 'string') {
    loadCommentCount(post.id, countComments);
  }

  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCommentsModal(post.id);
  });

  feed.appendChild(postEl);
}

// 4. COMENTARIOS
async function loadCommentCount(postId, element) {
  if (!supabaseClient) return;
  const { count } = await supabaseClient
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  if (count !== null) element.textContent = count;
}

async function openCommentsModal(postId) {
  activePostForComments = postId;
  commentsModal.classList.add('active');
  commentsList.innerHTML = '<p style="text-align:center; color:#888;">Cargando comentarios...</p>';

  if (supabaseClient && typeof postId === 'string') {
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
      commentsList.innerHTML = '<p style="text-align:center; color:#888;">Sé el primero en comentar.</p>';
    }
  } else {
    commentsList.innerHTML = '<p style="text-align:center; color:#888;">Comentarios de demostración.</p>';
  }
}

sendCommentBtn.addEventListener('click', async () => {
  const text = newCommentInput.value.trim();
  if (!text || !activePostForComments) return;

  if (supabaseClient && typeof activePostForComments === 'string') {
    await supabaseClient.from('comments').insert([
      { post_id: activePostForComments, content: text }
    ]);
  }

  newCommentInput.value = '';
  openCommentsModal(activePostForComments);
  loadPosts();
});

closeCommentsBtn.addEventListener('click', () => {
  commentsModal.classList.remove('active');
  activePostForComments = null;
});

// 5. PREVISUALIZAR FOTO O VIDEO
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

// 6. PUBLICAR
publishBtn.addEventListener('click', async () => {
  if (!selectedFile || !supabaseClient) return;

  publishBtn.disabled = true;
  publishBtn.textContent = 'Subiendo...';

  try {
    const isVideo = selectedFile.type.startsWith('video/');
    const mediaExt = selectedFile.name.split('.').pop();
    const mediaName = `${Date.now()}_media.${mediaExt}`;

    const { error: mediaError } = await supabaseClient.storage
      .from('fotos')
      .upload(mediaName, selectedFile);

    if (mediaError) throw mediaError;

    const { data: mediaUrlData } = supabaseClient.storage
      .from('fotos')
      .getPublicUrl(mediaName);

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
