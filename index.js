// точка входа, инициализация Firebase, авторизация
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { AppState, UIRenderer } from './app.js';

// Конфигурация Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCpqM2Mbz_0l1hB5BLgQ80F8GYFKdSw3PA",
  authDomain: "kirmelcript.firebaseapp.com",
  databaseURL: "https://kirmelcript-default-rtdb.firebaseio.com",
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

const state = new AppState();
state.setDb(db);

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
            displayName: user.displayName || "Аноним",
        });
        await state.registerUser(state.currentUser);
        await state.loadUsers();
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
        ui.render();
    }
});

// Для корректной работы выбираем первого пользователя при загрузке
state.subscribe((s) => {
  if (s.users.length && !s.selectedUserId) {
    s.selectUser(s.users[0].uid);
  }
});

// Поиск друга
document.getElementById('friend-search-btn').addEventListener('click', async () => {
    const inputValue = document.getElementById('friend-search-input').value.trim();
    const currentUser = auth.currentUser;

    if (!inputValue) return alert("Пимпочка пустая, введи ID!");
    if (!currentUser) return alert("Ты не вошел в аккаунт!");

    try {
        let targetUser = null;
        let targetUid = null;

        const userDocRef = doc(db, "users", inputValue);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            targetUser = userDocSnap.data();
            targetUid = inputValue;
        } else {
            const usersRef = collection(db, "users");
            const qEmail = query(usersRef, where("email", "==", inputValue));
            const queryEmail = await getDocs(qEmail);
            if (!queryEmail.empty) {
                const docSnap = queryEmail.docs[0];
                targetUser = docSnap.data();
                targetUid = docSnap.id;
            }
        }

        if (!targetUser) return alert("Кент не найден. Проверь ID/Email!");
        if (targetUid === currentUser.uid) return alert("Это твой собственный ID!");

        const chatID = [currentUser.uid, targetUid].sort().join("_");

        await setDoc(doc(db, "chats", chatID), {
            participants: [currentUser.uid, targetUid],
            updatedAt: new Date()
        }, { merge: true });

        const userExists = state.users.some(u => u.uid === targetUid);
        if (!userExists) {
            state.users.push({
                uid: targetUid,
                email: targetUser.email,
                displayName: targetUser.displayName || targetUser.email
            });
        }

        state.selectedUserId = targetUid;
        state.loadMessagesForUser(targetUid);
        ui.render();

        document.getElementById('friend-search-input').value = "";

    } catch (error) {
        console.error("Ошибка поиска:", error);
        alert("Не удалось добавить чат. Проверь консоль!");
    }
});

console.log('🔐 KirmelCript: приложение инициализировано с AES-GCM шифрованием');