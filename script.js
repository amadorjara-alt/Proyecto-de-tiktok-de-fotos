// 1. CONFIGURACIÓN SUPABASE
// Reemplaza con los datos reales de tu proyecto
const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU_CLAVE_ANON_AQUI';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Elementos DOM
const feed = document.getElementById('feed');
const fileInput = document.getElementById('file-input');
const previewModal = document.getElementById('preview-modal');
const previewImg = document.getElementById('preview-img');
const captionInput = document.getElementById('caption-input');
const cancelBtn = document.getElementById('cancel-btn');
const publishBtn = document.getElementById('publish-btn');
const filterTags = document.querySelectorAll('.filter-tag');

let selectedFile = null;
let selectedFilter = 'normal';

// Datos de demostración por si la base está vacía
const DEMO_POSTS = [
  {
    id: 1,
    image_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800',
    caption: 'Atardecer inolvidable ✨ #vibes #photo',
    username: '@carla_photo',
    likes: 1240
  },
  {
    id: 2,
    image_url: 'https://images.unsplash.com/photo-1526772662000-3f88f10405ff?w=800',
    caption: 'Explorando nuevos rincones de la ciudad 🏙️',
    username: '@alex_travels',
    likes: 856
  }
];

// 2. CARGAR PUBLICACIONES
async function loadPosts() {
  feed.innerHTML = '';
  
  let posts = [];
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data.length > 0) {
      posts = data;
    } else {
      posts = DEMO_POSTS;
    }
  } catch (err) {
    posts = DEMO_POSTS;
  }

  posts.forEach(post => renderPost(post));
}

// Renderizar una tarjeta individual
function renderPost(post) {
  const postEl = document.createElement('div');
  postEl.className = 'post';

  const likesCount = post.likes || Math.floor(Math.random() * 500) + 10;
  const username = post.username || '@usuario_' + Math.floor(Math.random() * 100);

  postEl.innerHTML = `
    <img class="post-img ${post.filter || ''}" src="${post.image_url}" alt="Foto">
    
    <div class="post-overlay">
      <div class="user-info">
        <img class="avatar" src="https://api.dicebear.com/7.x/bottts/svg?seed=${username}" alt="Avatar">
        <span class="username">${username}</span>
      </div>
      <p class="caption">${post.caption || ''}</p>
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
        <div class="action-count">34</div>
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

  // Interacciones: Botón "Me gusta"
  const likeBtn = postEl.querySelector('.like-btn');
  const countLikes = postEl.querySelector('.count-likes');
  let isLiked = false;

  likeBtn.addEventListener('click', () => {
    isLiked = !isLiked;
    likeBtn.classList.toggle('liked', isLiked);
    let current = parseInt(countLikes.textContent);
    countLikes.textContent = isLiked ? current + 1 : current - 1;
  });

  // Interacción: Doble Toque en la imagen para dar Like
  let lastTap = 0;
  const img = postEl.querySelector('.post-img');

  img.addEventListener('click', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    
    if (tapLength < 300 && tapLength > 0) {
      // Crear animación de corazón
      const heart = document.createElement('i');
      heart.className = 'fa-solid fa-heart like-heart-anim';
      postEl.appendChild(heart);

      setTimeout(() => heart.remove(), 700);

      if (!isLiked) {
        likeBtn.click();
      }
    }
    lastTap = currentTime;
  });

  feed.appendChild(postEl);
}

// 3. CAPTURAR Y PREVISUALIZAR FOTO
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  selectedFile = file;
  previewImg.src = URL.createObjectURL(file);
  previewModal.classList.add('active');
});

// Selección de Filtros
filterTags.forEach(tag => {
  tag.addEventListener('click', () => {
    filterTags.forEach(t => t.classList.remove('active'));
    tag.classList.add('active');
    
    selectedFilter = tag.dataset.filter;
    previewImg.className = selectedFilter !== 'normal' ? `filter-${selectedFilter}` : '';
  });
});

// Cancelar modal
cancelBtn.addEventListener('click', () => {
  previewModal.classList.remove('active');
  fileInput.value = '';
  selectedFile = null;
});

// 4. PUBLICAR FOTO EN SUPABASE
publishBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  publishBtn.disabled = true;
  publishBtn.textContent = 'Subiendo...';

  try {
    const fileName = `${Date.now()}_${selectedFile.name}`;

    // Subir a Storage
    const { data: storageData, error: storageError } = await supabase.storage
      .from('fotos')
      .upload(fileName, selectedFile);

    if (storageError) throw storageError;

    // Obtener URL
    const { data: publicUrlData } = supabase.storage
      .from('fotos')
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;

    // Insertar en la Base de Datos
    const { error: dbError } = await supabase
      .from('posts')
      .insert([
        {
          image_url: imageUrl,
          caption: captionInput.value,
          filter: selectedFilter !== 'normal' ? `filter-${selectedFilter}` : ''
        }
      ]);

    if (dbError) throw dbError;

    // Resetear UI
    captionInput.value = '';
    previewModal.classList.remove('active');
    fileInput.value = '';
    selectedFile = null;

    loadPosts();

  } catch (err) {
    alert('Error al publicar: ' + err.message);
  } finally {
    publishBtn.disabled = false;
    publishBtn.textContent = 'Publicar';
  }
});

// Iniciar app
loadPosts();