// app.js — модуль управления состоянием, UI и шифрованием
import { 
  collection, addDoc, query, orderBy, onSnapshot, 
  where, getDocs, updateDoc, doc, arrayUnion, arrayRemove 
} from 'firebase/firestore';

// --- Класс для работы с шифрованием AES-GCM (Web Crypto) ---
export class CryptoService {
  constructor() {
    // Ключ хранится в сессионной памяти (при обновлении страницы остаётся)
    // Для демонстрации используем sessionStorage, но для production лучше IndexedDB
    this.key = null;
    this.keyId = 'kirmel_aes_key';
    this._loadKeyFromSession();
  }

  async _loadKeyFromSession() {
    const stored = sessionStorage.getItem(this.keyId);
    if (stored) {
      try {
        const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
        this.key = await crypto.subtle.importKey(
          'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
        );
      } catch (e) {
        console.warn('Не удалось загрузить ключ, генерируем новый');
        this.key = null;
      }
    }
    if (!this.key) await this._generateAndStoreKey();
  }

  async _generateAndStoreKey() {
    this.key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const raw = await crypto.subtle.exportKey('raw', this.key);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
    sessionStorage.setItem(this.keyId, base64);
  }

  async encrypt(plaintext) {
    if (!this.key) await this._loadKeyFromSession();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, this.key, encoded
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encryptedBase64) {
    if (!this.key) await this._loadKeyFromSession();
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, this.key, ciphertext
      );
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error('Ошибка расшифровки:', e);
      return '[Зашифрованное сообщение]';
    }
  }
}

// --- Класс управления состоянием приложения ---
export class AppState {
  constructor() {
    this.currentUser = null;       // { uid, email, displayName }
    this.users = [];              // список пользователей для чатов
    this.messages = [];
    this.selectedUserId = null;
    this.crypto = new CryptoService();
    this.db = null;               // будет инициализирован firestore
    this.unsubscribeMessages = null;
    this._listeners = [];
  }

  // Подписка на изменения состояния (event-driven)
  subscribe(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  notify() {
    this._listeners.forEach(fn => fn(this));
  }

  setDb(db) { this.db = db; }

  setUser(user) {
    this.currentUser = user;
    this.notify();
  }

  setUsers(users) {
    this.users = users;
    this.notify();
  }

  setMessages(messages) {
    this.messages = messages;
    this.notify();
  }

  selectUser(userId) {
    if (this.selectedUserId === userId) return;
    this.selectedUserId = userId;
    this.loadMessagesForUser(userId);
  }

  async loadMessagesForUser(userId) {
    if (this.unsubscribeMessages) {
      this.unsubscribeMessages();
      this.unsubscribeMessages = null;
    }
    if (!this.currentUser || !userId) {
      this.setMessages([]);
      return;
    }

    const chatId = this._getChatId(this.currentUser.uid, userId);
    const messagesRef = collection(this.db, 'messages');
    const q = query(
      messagesRef,
      where('chatId', '==', chatId),
      orderBy('timestamp', 'asc')
    );

    this.unsubscribeMessages = onSnapshot(q, async (snapshot) => {
      const msgs = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        let decryptedText = '[Зашифровано]';
        try {
          decryptedText = await this.crypto.decrypt(data.encryptedText);
        } catch (e) { /* fallback */ }
        msgs.push({
          id: doc.id,
          from: data.from,
          to: data.to,
          text: decryptedText,
          timestamp: data.timestamp?.toDate?.() || new Date(data.timestamp),
        });
      }
      this.setMessages(msgs);
      // Автоскролл вниз (выполняется в UI)
    }, (error) => {
      console.error('Ошибка подписки на сообщения:', error);
    });
  }

  _getChatId(uid1, uid2) {
    return [uid1, uid2].sort().join('_');
  }

  async sendMessage(text) {
    if (!this.currentUser || !this.selectedUserId || !text.trim()) return;
    const chatId = this._getChatId(this.currentUser.uid, this.selectedUserId);
    const encrypted = await this.crypto.encrypt(text.trim());
    try {
      await addDoc(collection(this.db, 'messages'), {
        chatId,
        from: this.currentUser.uid,
        to: this.selectedUserId,
        encryptedText: encrypted,
        timestamp: new Date(),
      });
    } catch (e) {
      console.error('Ошибка отправки сообщения:', e);
      alert('Не удалось отправить сообщение');
    }
  }

  // Загрузка всех пользователей, кроме текущего
  async loadUsers() {
    if (!this.db || !this.currentUser) return;
    try {
      const usersRef = collection(this.db, 'users');
      const snapshot = await getDocs(usersRef);
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (doc.id !== this.currentUser.uid) {
          users.push({ uid: doc.id, email: data.email, displayName: data.displayName || data.email });
        }
      });
      this.setUsers(users);
    } catch (e) {
      console.error('Ошибка загрузки пользователей:', e);
    }
  }

  // Регистрация пользователя в Firestore
  async registerUser(user) {
    if (!this.db) return;
    const userRef = doc(this.db, 'users', user.uid);
    try {
      await updateDoc(userRef, {
        email: user.email,
        displayName: user.displayName || user.email,
        updatedAt: new Date()
      });
    } catch {
      // Если документ не существует, создаём
      await addDoc(collection(this.db, 'users'), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email,
        createdAt: new Date()
      });
    }
  }
}

// --- UI Рендерер (отвечает за отрисовку) ---
export class UIRenderer {
  constructor(state) {
    this.state = state;
    this.elements = {
      authSection: document.getElementById('auth-section'),
      messenger: document.getElementById('messenger'),
      userList: document.getElementById('user-list'),
      messagesContainer: document.getElementById('messages-container'),
      chatRecipient: document.getElementById('chat-recipient'),
      messageInput: document.getElementById('message-input'),
      currentUserEmail: document.getElementById('current-user-email'),
      sendBtn: document.getElementById('send-btn'),
    };
    this.state.subscribe(() => this.render());
    this._bindEvents();
  }

  _bindEvents() {
    // Отправка сообщения
    document.getElementById('message-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.elements.messageInput;
      const text = input.value;
      if (text.trim()) {
        this.state.sendMessage(text);
        input.value = '';
      }
    });
    // Выход
    document.getElementById('logout-btn').addEventListener('click', () => {
      // Логика выхода обрабатывается в index.js
      window.dispatchEvent(new CustomEvent('logout-request'));
    });
  }

  render() {
    const { currentUser, users, messages, selectedUserId } = this.state;
    // Показываем/скрываем секции
    if (currentUser) {
      this.elements.authSection.classList.add('hidden');
      this.elements.messenger.classList.remove('hidden');
      this.elements.currentUserEmail.textContent = currentUser.email || currentUser.displayName;
    } else {
      this.elements.authSection.classList.remove('hidden');
      this.elements.messenger.classList.add('hidden');
    }
    this._renderUsers(users, selectedUserId);
    this._renderMessages(messages);
    // Обновляем заголовок чата
    const recipient = users.find(u => u.uid === selectedUserId);
    this.elements.chatRecipient.textContent = recipient ? recipient.displayName || recipient.email : 'Выберите чат';
    // Скролл вниз
    const container = this.elements.messagesContainer;
    if (container) container.scrollTop = container.scrollHeight;
  }

  _renderUsers(users, selectedId) {
    const container = this.elements.userList;
    if (!container) return;
    if (!users.length) {
      container.innerHTML = '<div class="user-item" style="color:var(--text-secondary);">Нет других пользователей</div>';
      return;
    }
    container.innerHTML = users.map(user => `
      <div class="user-item ${user.uid === selectedId ? 'active' : ''}" data-uid="${user.uid}">
        <div class="user-avatar">${(user.displayName || user.email)[0].toUpperCase()}</div>
        <span class="user-email">${user.displayName || user.email}</span>
      </div>
    `).join('');
    // Клик по пользователю
    container.querySelectorAll('.user-item').forEach(el => {
      el.addEventListener('click', () => {
        const uid = el.dataset.uid;
        this.state.selectUser(uid);
      });
    });
  }

  _renderMessages(messages) {
    const container = this.elements.messagesContainer;
    if (!container) return;
    if (!messages.length) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px 0;">Сообщений пока нет</div>';
      return;
    }
    const currentUid = this.state.currentUser?.uid;
    container.innerHTML = messages.map(msg => {
      const isSelf = msg.from === currentUid;
      const time = msg.timestamp instanceof Date ? msg.timestamp.toLocaleTimeString() : '';
      return `<div class="message ${isSelf ? 'self' : 'other'}">
        ${msg.text}
        <span class="timestamp">${time}</span>
      </div>`;
    }).join('');
  }
}я