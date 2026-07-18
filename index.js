// точка входа, инициализация Firebase, авторизация
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut 
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { AppState, UIRenderer } from './app.js';

// Конфигурация Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCpqM2Mbz_0l1hB5BLgQ80F8GYFKdSw3PA",
    authDomain: "kirmelcript.firebaseapp.com",
    projectId: "kirmelcript",
    storageBucket: "kirmelcript.firebasestorage.app",
    messagingSenderId: "668992683850",
    appId: "1:668992683850:web:c2f76667fafac7cd714bb3",
    measurementId: "G-MD938Z2WX6"
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Состояние приложения
const state = new AppState();
state.setDb(db);

// UI Рендерер
const ui = new UIRenderer(state);

// Обработчик входа через Google
document.getElementById('google-login-btn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    state.setUser({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
    });
    await state.registerUser(state.currentUser);
    await state.loadUsers();
  } catch (error) {
    console.error('Ошибка входа:', error);
    alert('Не удалось войти. Проверьте консоль.');
  }
});

// Выход
window.addEventListener('logout-request', async () => {
  try {
    await signOut(auth);
    state.setUser(null);
    state.setUsers([]);
    state.setMessages([]);
    if (state.unsubscribeMessages) {
      state.unsubscribeMessages();
      state.unsubscribeMessages = null;
    }
  } catch (e) {
    console.error('Ошибка выхода:', e);
  }
});

// Отслеживание состояния аутентификации
onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.setUser({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
    });
    await state.registerUser(state.currentUser);
    await state.loadUsers();
    // Если есть ранее выбранный пользователь, перезагружаем чат
    if (state.selectedUserId) {
      state.loadMessagesForUser(state.selectedUserId);
    }
  } else {
    state.setUser(null);
    state.setUsers([]);
    state.setMessages([]);
    if (state.unsubscribeMessages) {
      state.unsubscribeMessages();
      state.unsubscribeMessages = null;
    }
    // Показываем экран входа
    ui.render();
  }
});

// Для корректной работы выбираем первого пользователя при загрузке
state.subscribe((s) => {
  if (s.users.length && !s.selectedUserId) {
    s.selectUser(s.users[0].uid);
  }
});

console.log('🔐 KirmelCript: приложение инициализировано с AES-GCM шифрованием');