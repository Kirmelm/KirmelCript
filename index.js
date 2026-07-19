// точка входа, инициализация Firebase, авторизация
import { initializeApp } from "https://gstatic.com";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://gstatic.com";
import { getFirestore, collection, query, where, getDocs, setDoc, doc, getDoc } from "https://gstatic.com";
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
        // Сначала временно ставим то, что есть в Google аккаунте
        state.setUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || "Аноним",
        });

        // Регистрируем/обновляем в БД (код функции registerUser мы исправим на следующем шаге)
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

// Финальная рабочая логика поиска кента
document.getElementById('friend-search-btn').addEventListener('click', async () => {
    const inputValue = document.getElementById('friend-search-input').value.trim();
    const currentUser = auth.currentUser;

    if (!inputValue) return alert("Пимпочка пустая, введи ID!");
    if (!currentUser) return alert("Ты не вошел в аккаунт!");

    try {
        let targetUser = null;

        // 1. Ищем по UID в коллекции users
        const userDocRef = doc(db, "users", inputValue);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            targetUser = userDocSnap.data();
        } else {
            // 2. Если по UID не нашли, ищем по Email
            const usersRef = collection(db, "users");
            const qEmail = query(usersRef, where("email", "==", inputValue));
            const queryEmail = await getDocs(qEmail);
            if (!queryEmail.empty) {
                targetUser = queryEmail.docs.data();
            }
        }

        if (!targetUser) return alert("Кент не найден. Проверь ID/Email!");
        if (targetUser.uid === currentUser.uid) return alert("Это твой собственный ID!");

        // 3. Создаем чат в базе chats
        const chatID = [currentUser.uid, targetUser.uid].sort().join("_");

        await setDoc(doc(db, "chats", chatID), {
            participants: [currentUser.uid, targetUser.uid],
            updatedAt: new Date()
        }, { merge: true });

        // 4. Запихиваем кента в стейт, чтобы он появился в списке
        // Если в state.users его еще нет, добавляем вручную
        const userExists = state.users.some(u => u.uid === targetUser.uid);
        if (!userExists) {
            state.users.push(targetUser);
        }

        // Выбираем этого пользователя активным
        state.selectedUserId = targetUser.uid;
        
        // Включаем прослушку сообщений для этого чата
        if (typeof state.loadMessagesForUser === "function") {
            state.loadMessagesForUser(targetUser.uid);
        }

        // ПИНАЕМ ИНТЕРФЕЙС, ЧТОБЫ ОН ВСЁ ПЕРЕРИСОВАЛ
        if (typeof ui !== "undefined" && typeof ui.render === "function") {
            ui.render();
        }

        // Очищаем инпут
        document.getElementById('friend-search-input').value = "";

    } catch (error) {
        console.error("Ошибка поиска:", error);
        alert("Не удалось добавить чат. Проверь консоль!");
    }
});


console.log('🔐 KirmelCript: приложение инициализировано с AES-GCM шифрованием');