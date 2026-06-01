const { createApp, ref, reactive, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        const API_URL = '/api';

        // --- States ---
        const viewMode = ref('player'); // 'player' or 'admin'
        const activeTab = ref('crosswords'); // default admin tab
        const currentUser = ref(null);
        const currentNotes = ref([]);
        const notesLoading = ref(true);
        const showForm = ref(false);

        // Crossword Admin States
        const crosswordDirs = ref([]);
        const dirsLoading = ref(true);
        const newDirName = ref('');
        const selectedAdminDir = ref('');
        const uploadTargetDir = ref('');
        const isDragOver = ref(false);
        const selectedFileName = ref('');
        const parsedFileWords = ref([]);

        // Crossword Play States
        const gameState = ref('setup'); // 'setup', 'playing', 'completed'
        const showCluesModal = ref(false);
        const revealMode = ref(false);   // toggle to allow dblclick reveal
        const revealCount = ref(0);      // how many cells have been revealed

        // Timer state
        const timerSeconds = ref(0);
        let _timerInterval = null;
        const timerDisplay = computed(() => {
            const s = timerSeconds.value;
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        });

        const startTimer = () => {
            stopTimer();
            timerSeconds.value = 0;
            _timerInterval = setInterval(() => { timerSeconds.value++; }, 1000);
        };
        const stopTimer = () => {
            if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
        };
        const playConfig = reactive({
            directory: '',
            wordCount: 10
        });
        const maxAvailableWords = ref(10);
        const requestedCount = ref(10);
        const rawDirectoryWords = ref([]);

        // New play and ranking states
        const selectedPlayDirs = ref([]); // array of selected directory names
        const rankingFilter = ref('all'); // 'selected' or 'all'
        const rankingList = ref([]);
        const rankingLoading = ref(false);
        const scoreSubmitted = ref(false);
        const submittingScore = ref(false);
        const rankingForm = reactive({
            playerName: ''
        });

        // Profile Modal states
        const showProfileModal = ref(false);
        const showAuthModal = ref(false);
        const authModalTab = ref('login');
        const changingPassword = ref(false);

        // Guest identity (localStorage-persisted)
        const guestName = ref(localStorage.getItem('guestName') || '');
        const guestAvatar = ref(localStorage.getItem('guestAvatar') || 'avatar1');

        const avatarOptions = ['avatar1', 'avatar2', 'avatar3', 'avatar4', 'avatar5', 'avatar6'];

        const profileForm = reactive({
            guestName: guestName.value,
            customAvatarUrl: '',
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
            uploadFileName: ''
        });

        // Prefill ranking name if user is logged in
        Vue.watch(currentUser, (newVal) => {
            if (newVal) {
                rankingForm.playerName = newVal.username;
            } else {
                rankingForm.playerName = guestName.value || '';
            }
        }, { immediate: true });
        const placedWords = ref([]); // List of placed words with clues and grid positions
        const gridCells = ref([]); // 2D array of cells
        const acrossClues = ref([]); // Across clues list
        const downClues = ref([]); // Down clues list

        // Active cell selection
        const activeRow = ref(-1);
        const activeCol = ref(-1);
        const activeDirection = ref('across'); // 'across' or 'down'

        // Canvas pan & zoom state
        const canvasViewport = ref(null);  // template ref
        const panX = ref(0);
        const panY = ref(0);
        const zoomScale = ref(1.0);
        const isDragging = ref(false);
        let _panStartX = 0;
        let _panStartY = 0;
        let _panOriginX = 0;
        let _panOriginY = 0;
        const ZOOM_MIN = 0.25;
        const ZOOM_MAX = 3.0;
        const ZOOM_STEP = 0.1;

        // Health Status Check
        const serviceStatus = reactive({
            nginx: 'ok',
            backend: 'pending',
            database: 'pending'
        });

        // Form Fields for Notes CRUD
        const noteForm = reactive({
            id: '',
            title: '',
            content: ''
        });

        const authForm = reactive({
            loginUsername: '',
            loginPassword: '',
            regUsername: '',
            regPassword: ''
        });

        // Toast States
        const toast = reactive({
            show: false,
            message: '',
            type: 'info',
            timeoutId: null
        });

        // Computed Toast Color
        const toastBorderColor = computed(() => {
            if (toast.type === 'success') return 'var(--success)';
            if (toast.type === 'error') return 'var(--danger)';
            if (toast.type === 'warning') return 'var(--warning)';
            return 'var(--primary)';
        });

        // Dynamic style for CSS grid board sizing
        const gridBoardStyle = computed(() => {
            if (gridCells.value.length === 0) return {};
            const rows = gridCells.value.length;
            const cols = gridCells.value[0].length;
            return {
                gridTemplateRows: `repeat(${rows}, 42px)`,
                gridTemplateColumns: `repeat(${cols}, 42px)`
            };
        });

        // --- Helpers ---
        const formatDate = (dateStr) => {
            return new Date(dateStr).toLocaleString();
        };

        const canEdit = (note) => {
            if (!currentUser.value) {
                return note.createdBy === 'Guest';
            }
            return currentUser.value.role === 'admin' || note.createdBy === currentUser.value.username;
        };

        const showToast = (message, type = 'info') => {
            if (toast.timeoutId) {
                clearTimeout(toast.timeoutId);
            }
            toast.message = message;
            toast.type = type;
            toast.show = true;

            toast.timeoutId = setTimeout(() => {
                toast.show = false;
            }, 4000);
        };

        const switchTab = (tabId) => {
            activeTab.value = tabId;
            if (tabId === 'notes') {
                fetchNotes();
                hideNoteForm();
            }
        };

        const switchViewMode = (mode) => {
            viewMode.value = mode;
            if (mode === 'admin') {
                activeTab.value = 'crosswords';
                fetchCrosswordDirs();
                window.location.hash = 'admin';
            } else {
                gameState.value = 'setup';
                fetchCrosswordDirs();
                window.location.hash = '';
            }
        };

        const statusClass = (status) => {
            return {
                'status-ok': status === 'ok',
                'status-pending': status === 'pending',
                'status-error': status === 'error'
            };
        };

        // ── Avatar SVG generator ──────────────────────────────
        const AVATAR_COLORS = [
            ['#7c3aed', '#ede9fe'], ['#db2777', '#fce7f3'], ['#0891b2', '#cffafe'],
            ['#d97706', '#fef3c7'], ['#059669', '#d1fae5'], ['#dc2626', '#fee2e2']
        ];
        const AVATAR_SYMBOLS = ['😺', '🦊', '🐧', '🦁', '🐸', '🦄'];

        const getAvatarSvg = (av) => {
            if (av && av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.src=''"/>`;
            }
            const idx = parseInt((av || 'avatar1').replace('avatar', '')) - 1;
            const safeIdx = Math.max(0, Math.min(5, isNaN(idx) ? 0 : idx));
            const [bg] = AVATAR_COLORS[safeIdx];
            const sym = AVATAR_SYMBOLS[safeIdx];
            return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><circle cx="20" cy="20" r="20" fill="${bg}"/><text x="20" y="27" text-anchor="middle" font-size="20">${sym}</text></svg>`;
        };

        // getAvatarDisplay — renders base64 data URLs as <img>, preset keys as SVG
        const getAvatarDisplay = (av) => {
            if (!av) av = 'avatar1';
            // Base64 data URL or http URL
            if (av.startsWith('data:') || av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
            }
            // Preset SVG avatar
            return getAvatarSvg(av);
        };

        // onAvatarFileSelected — converts chosen image file to base64 and saves
        const onAvatarFileSelected = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                showToast('❌ Image file must be under 2 MB', 'error');
                return;
            }
            profileForm.uploadFileName = file.name;
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                selectAvatar(dataUrl);
            };
            reader.readAsDataURL(file);
            // Reset input so same file can be re-selected
            event.target.value = '';
        };

        const openProfileModal = () => {
            profileForm.guestName = guestName.value;
            profileForm.customAvatarUrl = '';
            profileForm.currentPassword = '';
            profileForm.newPassword = '';
            profileForm.confirmPassword = '';
            showProfileModal.value = true;
        };

        const openAuthModal = (tab = 'login') => {
            authModalTab.value = tab;
            showAuthModal.value = true;
        };

        const saveGuestName = () => {
            const name = profileForm.guestName.trim();
            guestName.value = name;
            localStorage.setItem('guestName', name);
            if (!currentUser.value) rankingForm.playerName = name;
            showToast('✅ Display name saved!', 'success');
        };

        const selectAvatar = async (av) => {
            if (currentUser.value) {
                try {
                    const res = await fetch(`${API_URL}/auth/update-avatar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ avatar: av })
                    });
                    const data = await res.json();
                    if (data.success) {
                        currentUser.value = { ...currentUser.value, avatar: av };
                        showToast('🎨 Avatar updated!', 'success');
                    } else {
                        showToast(`❌ ${data.message}`, 'error');
                    }
                } catch (e) {
                    showToast('❌ Connection error', 'error');
                }
            } else {
                guestAvatar.value = av;
                localStorage.setItem('guestAvatar', av);
                showToast('🎨 Avatar updated!', 'success');
            }
        };

        const applyCustomAvatar = () => {
            const url = profileForm.customAvatarUrl.trim();
            if (!url) return;
            selectAvatar(url);
        };

        const changePassword = async () => {
            if (!profileForm.newPassword || profileForm.newPassword.length < 6) {
                showToast('❌ New password must be at least 6 characters', 'error'); return;
            }
            if (profileForm.newPassword !== profileForm.confirmPassword) {
                showToast('❌ Passwords do not match', 'error'); return;
            }
            changingPassword.value = true;
            try {
                const res = await fetch(`${API_URL}/auth/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        currentPassword: profileForm.currentPassword,
                        newPassword: profileForm.newPassword
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('✅ Password changed successfully!', 'success');
                    profileForm.currentPassword = '';
                    profileForm.newPassword = '';
                    profileForm.confirmPassword = '';
                } else {
                    showToast(`❌ ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Connection error', 'error');
            } finally {
                changingPassword.value = false;
            }
        };

        const handleLoginModal = async () => {
            const username = authForm.loginUsername.trim();
            const password = authForm.loginPassword;
            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();
                if (data.success) {
                    showToast('✅ Logged in successfully!', 'success');
                    currentUser.value = data.user;
                    authForm.loginUsername = '';
                    authForm.loginPassword = '';
                    showAuthModal.value = false;
                } else {
                    showToast(`❌ Login Failed: ${data.message}`, 'error');
                }
            } catch (error) {
                showToast('❌ Server error during login', 'error');
            }
        };

        const handleRegisterModal = async () => {
            const username = authForm.regUsername.trim();
            const password = authForm.regPassword;
            try {
                const response = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();
                if (data.success) {
                    showToast('✅ Account created! You can now log in.', 'success');
                    authForm.regUsername = '';
                    authForm.regPassword = '';
                    authModalTab.value = 'login';
                } else {
                    showToast(`❌ Registration Failed: ${data.message}`, 'error');
                }
            } catch (error) {
                showToast('❌ Server error during registration', 'error');
            }
        };

        const logoutPlayer = async () => {
            try {
                await fetch(`${API_URL}/auth/logout`, { method: 'POST' });
            } catch (e) { }
            currentUser.value = null;
            showToast('🚪 Logged out successfully', 'info');
        };

        const formatRankDate = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        };

        // --- 🌐 Health Monitoring ---
        const checkHealth = async () => {
            serviceStatus.nginx = 'ok';
            try {
                const response = await fetch(`${API_URL}/health`);
                if (!response.ok) throw new Error('API server returned error');
                const data = await response.json();

                if (data.success) {
                    serviceStatus.backend = data.services.backend === 'running' ? 'ok' : 'error';
                    serviceStatus.database = data.services.database === 'connected' ? 'ok' : 'error';
                }
            } catch (error) {
                console.error('Health check failed:', error);
                serviceStatus.backend = 'error';
                serviceStatus.database = 'error';
            }
        };

        // --- 🔒 Authentication & Profile ---
        const fetchUserProfile = async () => {
            try {
                const response = await fetch(`${API_URL}/auth/profile`);
                const data = await response.json();
                if (data.success && data.authenticated) {
                    currentUser.value = data.user;
                } else {
                    currentUser.value = null;
                }
            } catch (err) {
                console.error('Failed to fetch user session:', err);
                currentUser.value = null;
            }
        };

        const handleLogin = async () => {
            const username = authForm.loginUsername.trim();
            const password = authForm.loginPassword;

            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();

                if (data.success) {
                    showToast('✅ Logged in successfully!', 'success');
                    currentUser.value = data.user;
                    authForm.loginUsername = '';
                    authForm.loginPassword = '';
                    switchTab('crosswords');
                } else {
                    showToast(`❌ Login Failed: ${data.message}`, 'error');
                }
            } catch (error) {
                showToast('❌ Server error during login', 'error');
            }
        };

        const handleRegister = async () => {
            const username = authForm.regUsername.trim();
            const password = authForm.regPassword;

            try {
                const response = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();

                if (data.success) {
                    showToast('✅ Account registered successfully! You can login now.', 'success');
                    authForm.regUsername = '';
                    authForm.regPassword = '';
                    authForm.loginUsername = username;
                } else {
                    showToast(`❌ Registration Failed: ${data.message}`, 'error');
                }
            } catch (error) {
                showToast('❌ Server error during registration', 'error');
            }
        };

        const logout = async () => {
            try {
                const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST' });
                const data = await response.json();

                if (data.success) {
                    showToast('🚪 Logged out successfully', 'info');
                    currentUser.value = null;
                    switchTab('auth');
                } else {
                    showToast('❌ Logout failed', 'error');
                }
            } catch (error) {
                showToast('❌ Connection error during logout', 'error');
            }
        };

        // --- 📝 Notes CRUD (Template Feature Preserved) ---
        const fetchNotes = async () => {
            notesLoading.value = true;
            try {
                const response = await fetch(`${API_URL}/notes`);
                const data = await response.json();
                if (data.success) {
                    currentNotes.value = data.data;
                } else {
                    showToast(`❌ Failed to fetch notes: ${data.message}`, 'error');
                }
            } catch (error) {
                console.error('Failed to connect to backend notes API:', error);
            } finally {
                notesLoading.value = false;
            }
        };

        const showNoteForm = (note = null) => {
            showForm.value = true;
            if (note) {
                noteForm.id = note._id;
                noteForm.title = note.title;
                noteForm.content = note.content;
            } else {
                noteForm.id = '';
                noteForm.title = '';
                noteForm.content = '';
            }
            nextTick(() => {
                const formCard = document.getElementById('noteFormCard');
                if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
            });
        };

        const hideNoteForm = () => {
            showForm.value = false;
            noteForm.id = '';
            noteForm.title = '';
            noteForm.content = '';
        };

        const saveNote = async () => {
            const id = noteForm.id;
            const title = noteForm.title.trim();
            const content = noteForm.content.trim();

            const notePayload = { title, content };
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_URL}/notes/${id}` : `${API_URL}/notes`;

            try {
                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(notePayload)
                });
                const data = await response.json();

                if (data.success) {
                    showToast(id ? '✅ Note updated successfully' : '✅ Note created successfully', 'success');
                    hideNoteForm();
                    fetchNotes();
                } else {
                    showToast(`❌ Error: ${data.message}`, 'error');
                }
            } catch (error) {
                showToast('❌ Server connection refused', 'error');
            }
        };

        const editNote = (note) => {
            showNoteForm(note);
        };

        const deleteNote = async (noteId) => {
            if (!confirm('Are you sure you want to delete this note from MongoDB?')) return;
            try {
                const response = await fetch(`${API_URL}/notes/${noteId}`, { method: 'DELETE' });
                const data = await response.json();
                if (data.success) {
                    showToast('🗑️ Note deleted successfully', 'success');
                    fetchNotes();
                } else {
                    showToast(`❌ Error: ${data.message}`, 'error');
                }
            } catch (error) {
                showToast('❌ Server connection refused', 'error');
            }
        };


        // --- 🧩 Crossword Admin logic ---

        const fetchCrosswordDirs = async () => {
            dirsLoading.value = true;
            try {
                const response = await fetch(`${API_URL}/crosswords/directories`);
                const data = await response.json();
                if (data.success) {
                    crosswordDirs.value = data.data;

                    // Sync play directory selection
                    if (crosswordDirs.value.length > 0 && selectedPlayDirs.value.length === 0) {
                        selectedPlayDirs.value = [crosswordDirs.value[0].name];
                        onSelectedDirsChange();
                    }
                }
            } catch (e) {
                showToast('❌ Failed to fetch crossword categories', 'error');
            } finally {
                dirsLoading.value = false;
            }
        };

        // Track how many words exist in selected category to prevent selecting more than available
        const onSelectedDirsChange = async () => {
            if (selectedPlayDirs.value.length === 0) {
                maxAvailableWords.value = 0;
                playConfig.wordCount = 0;
                return;
            }
            try {
                const dirsParam = selectedPlayDirs.value.join(',');
                const response = await fetch(`${API_URL}/crosswords/words?directory=${encodeURIComponent(dirsParam)}`);
                const data = await response.json();
                if (data.success) {
                    maxAvailableWords.value = data.data.length;

                    if (playConfig.wordCount > maxAvailableWords.value || playConfig.wordCount <= 0) {
                        playConfig.wordCount = Math.min(10, maxAvailableWords.value);
                    }

                    if (maxAvailableWords.value >= 3 && playConfig.wordCount < 3) {
                        playConfig.wordCount = 3;
                    } else if (maxAvailableWords.value < 3) {
                        playConfig.wordCount = maxAvailableWords.value;
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };

        const toggleSelectPlayDir = (dirName) => {
            const idx = selectedPlayDirs.value.indexOf(dirName);
            if (idx > -1) {
                selectedPlayDirs.value.splice(idx, 1);
            } else {
                selectedPlayDirs.value.push(dirName);
            }
            onSelectedDirsChange();
        };

        // Watch for selected directories or filter tabs to refresh rankings
        Vue.watch(rankingFilter, () => {
            fetchRankings();
        });

        Vue.watch(selectedPlayDirs, (newVal) => {
            if (newVal.length > 0) {
                fetchRankings();
            } else {
                rankingList.value = [];
            }
        }, { deep: true });

        const createDirectory = async () => {
            if (!newDirName.value.trim()) return;
            try {
                const response = await fetch(`${API_URL}/crosswords/directories`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newDirName.value.trim() })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(`✅ Created category '${newDirName.value}' successfully!`, 'success');
                    newDirName.value = '';
                    fetchCrosswordDirs();
                } else {
                    showToast(`❌ Failed to create category: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Server connection error', 'error');
            }
        };

        const deleteDirectory = async (name) => {
            if (!confirm(`Are you sure you want to delete category '${name}' and all its words? This action cannot be undone.`)) return;
            try {
                const response = await fetch(`${API_URL}/crosswords/directories/${name}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (data.success) {
                    showToast('🗑️ Category deleted successfully', 'success');
                    if (selectedAdminDir.value === name) selectedAdminDir.value = '';
                    if (uploadTargetDir.value === name) uploadTargetDir.value = '';
                    if (playConfig.directory === name) playConfig.directory = '';
                    fetchCrosswordDirs();
                } else {
                    showToast(`❌ Delete failed: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Server connection error', 'error');
            }
        };

        const selectAdminDir = (name) => {
            selectedAdminDir.value = name;
            uploadTargetDir.value = name;
        };

        // Drag & drop handlers
        const onDragOver = () => {
            isDragOver.value = true;
        };

        const onDragLeave = () => {
            isDragOver.value = false;
        };

        const triggerFileInput = () => {
            const inputEl = document.querySelector('input[type="file"]');
            if (inputEl) inputEl.click();
        };

        const onFileSelected = (e) => {
            const file = e.target.files[0];
            if (file) handleFile(file);
        };

        const onDropFile = (e) => {
            isDragOver.value = false;
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        };

        const handleFile = (file) => {
            if (!file.name.endsWith('.csv')) {
                showToast('❌ Only .csv files are supported', 'error');
                return;
            }
            selectedFileName.value = file.name;

            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                parseCSVText(text);
            };
            reader.readAsText(file, 'UTF-8');
        };

        const parseCSVText = (text) => {
            const lines = text.split(/\r?\n/);
            const results = [];

            for (const line of lines) {
                if (!line.trim()) continue;

                // Quote-aware CSV cell splitting
                let cells = [];
                let current = '';
                let inQuotes = false;

                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        cells.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                cells.push(current.trim());

                // Clean quotes from parsed cells
                cells = cells.map(c => c.replace(/^"|"$/g, '').trim());

                if (cells.length >= 2 && cells[0]) {
                    // Keep original text for verification, but clean word for crossword grids
                    // We only strip spaces, dashes, commas and parentheses, leaving normal alphabet letters of any language.
                    const cleanWord = cells[0].toUpperCase().replace(/[\s\-_,\.\(\)\[\]"']/g, '');
                    if (cleanWord.length >= 2) {
                        results.push({
                            word: cleanWord,
                            clue: cells[1]
                        });
                    }
                }
            }

            parsedFileWords.value = results;
            if (results.length === 0) {
                showToast('⚠️ No valid word data found in the CSV file', 'warning');
            } else {
                showToast(`📊 File read successfully! Found ${results.length} words`, 'success');
            }
        };

        const clearParsedFile = () => {
            selectedFileName.value = '';
            parsedFileWords.value = [];
        };

        const submitUploadedWords = async () => {
            if (!uploadTargetDir.value) {
                showToast('⚠️ Please select a category to save to', 'warning');
                return;
            }
            if (parsedFileWords.value.length === 0) {
                showToast('⚠️ No words to save', 'warning');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/crosswords/upload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        directory: uploadTargetDir.value,
                        words: parsedFileWords.value
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(`✅ Successfully imported ${data.count} words to category '${uploadTargetDir.value}'!`, 'success');
                    clearParsedFile();
                    fetchCrosswordDirs();
                } else {
                    showToast(`❌ Upload failed: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Server connection failed', 'error');
            }
        };


        // --- 🎮 Crossword Game Generator & Interface logic ---

        const startGame = async () => {
            if (selectedPlayDirs.value.length === 0) return;
            try {
                const dirsParam = selectedPlayDirs.value.join(',');
                const response = await fetch(`${API_URL}/crosswords/words?directory=${encodeURIComponent(dirsParam)}`);
                const data = await response.json();
                if (!data.success || data.data.length === 0) {
                    showToast('❌ Cannot start game: No words found in the selected category', 'error');
                    return;
                }

                rawDirectoryWords.value = data.data;
                requestedCount.value = playConfig.wordCount;

                // Build crossword grid layout
                const generated = generateCrossword(data.data, playConfig.wordCount);
                if (!generated || generated.placed.length === 0) {
                    showToast('⚠️ Failed to generate crossword grid. Please try again or add more words.', 'warning');
                    return;
                }

                placedWords.value = generated.placed;
                gridCells.value = generated.gridCells;
                acrossClues.value = generated.acrossClues;
                downClues.value = generated.downClues;

                gameState.value = 'playing';
                startTimer();
                revealMode.value = false;
                revealCount.value = 0;

                // Automatically focus the first cell of the first clue
                nextTick(() => {
                    const allClues = [...acrossClues.value, ...downClues.value];
                    if (allClues.length > 0) {
                        selectClue(allClues[0]);
                    }
                });

            } catch (e) {
                console.error(e);
                showToast('❌ Error loading game challenge', 'error');
            }
        };

        // Core Crossword Layout algorithm
        const generateCrossword = (wordsList, targetCount) => {
            // Filter and map vocabulary
            let cleanList = wordsList.map(w => ({
                word: w.word.trim().toUpperCase().replace(/[\s\-_,\.\(\)\[\]"']/g, ''),
                clue: w.clue
            })).filter(w => w.word.length >= 2);

            if (cleanList.length === 0) return null;

            // Pick randomized target count
            let bestRun = null;
            let maxPlacedCount = 0;
            let maxScore = -1;

            // Execute 25 iterations to search for the best grid layout with maximum connectivity
            for (let run = 0; run < 25; run++) {
                // Shuffle list randomly
                let shuffled = [...cleanList].sort(() => Math.random() - 0.5);
                let selected = shuffled.slice(0, targetCount);

                // Sort by word length descending - longer words are best to place first
                selected.sort((a, b) => b.word.length - a.word.length);

                const GRID_SIZE = 60;
                let grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null));
                let placed = [];

                // Place the first word (longest) horizontally at center
                const firstWord = selected[0].word;
                const startX = Math.floor(GRID_SIZE / 2 - firstWord.length / 2);
                const startY = Math.floor(GRID_SIZE / 2);

                for (let i = 0; i < firstWord.length; i++) {
                    grid[startY][startX + i] = firstWord[i];
                }

                placed.push({
                    word: firstWord,
                    clue: selected[0].clue,
                    x: startX,
                    y: startY,
                    direction: 'across'
                });

                // Try placing subsequent words
                for (let wIdx = 1; wIdx < selected.length; wIdx++) {
                    const currentItem = selected[wIdx];
                    const word = currentItem.word;

                    let bestPositionForWord = null;
                    let highestScoreForWord = -Infinity;

                    // Scan grid for potential intersection points
                    for (let y = 0; y < GRID_SIZE; y++) {
                        for (let x = 0; x < GRID_SIZE; x++) {
                            const gridChar = grid[y][x];
                            if (!gridChar) continue;

                            // If word contains this character, evaluate alignment options
                            let letterIdx = -1;
                            while ((letterIdx = word.indexOf(gridChar, letterIdx + 1)) !== -1) {
                                // Try placing word perpendicular to grid cell
                                const directions = ['across', 'down'];
                                for (const dir of directions) {
                                    const sX = (dir === 'across') ? x - letterIdx : x;
                                    const sY = (dir === 'across') ? y : y - letterIdx;

                                    if (checkPlacementValidity(grid, word, sX, sY, dir, GRID_SIZE)) {
                                        const score = calculatePlacementScore(grid, word, sX, sY, dir, GRID_SIZE);
                                        if (score > highestScoreForWord) {
                                            highestScoreForWord = score;
                                            bestPositionForWord = { x: sX, y: sY, direction: dir, score };
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Place the word at its best scoring position
                    if (bestPositionForWord) {
                        for (let i = 0; i < word.length; i++) {
                            const cx = (bestPositionForWord.direction === 'across') ? bestPositionForWord.x + i : bestPositionForWord.x;
                            const cy = (bestPositionForWord.direction === 'across') ? bestPositionForWord.y : bestPositionForWord.y + i;
                            grid[cy][cx] = word[i];
                        }
                        placed.push({
                            word: word,
                            clue: currentItem.clue,
                            x: bestPositionForWord.x,
                            y: bestPositionForWord.y,
                            direction: bestPositionForWord.direction
                        });
                    }
                }

                // Sum up placement success metrics
                if (placed.length > maxPlacedCount) {
                    maxPlacedCount = placed.length;

                    // Sum scores
                    let totalScore = placed.reduce((sum, p) => sum + (p.score || 0), 0);
                    maxScore = totalScore;
                    bestRun = { grid, placed };
                } else if (placed.length === maxPlacedCount && placed.length > 0) {
                    let totalScore = placed.reduce((sum, p) => sum + (p.score || 0), 0);
                    if (totalScore > maxScore) {
                        maxScore = totalScore;
                        bestRun = { grid, placed };
                    }
                }
            }

            if (!bestRun) return null;

            // Crop the grid to active boundaries
            const grid = bestRun.grid;
            const placed = bestRun.placed;
            const GRID_SIZE = 60;

            let minX = GRID_SIZE, maxX = 0, minY = GRID_SIZE, maxY = 0;
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    if (grid[y][x] !== null) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            // Pad the cropped grid with 1 cell on each side
            minX = Math.max(0, minX - 1);
            maxX = Math.min(GRID_SIZE - 1, maxX + 1);
            minY = Math.max(0, minY - 1);
            maxY = Math.min(GRID_SIZE - 1, maxY + 1);

            const croppedRows = maxY - minY + 1;
            const croppedCols = maxX - minX + 1;

            // Create mapped cropped grid
            let finalGrid = Array(croppedRows).fill(null).map((_, r) => {
                return Array(croppedCols).fill(null).map((_, c) => {
                    const originalY = minY + r;
                    const originalX = minX + c;
                    return {
                        isActive: grid[originalY][originalX] !== null,
                        char: grid[originalY][originalX] || '',
                        guess: '',
                        number: null,
                        checked: false,
                        isCorrect: false,
                        row: r,
                        col: c,
                        words: []
                    };
                });
            });

            // Re-offset coordinates of placed words to cropped grid
            placed.forEach((p, index) => {
                p.x = p.x - minX;
                p.y = p.y - minY;
                p.id = index;
            });

            // Assign numbers sequentially row-by-row
            let numberCounter = 1;
            for (let r = 0; r < croppedRows; r++) {
                for (let c = 0; c < croppedCols; c++) {
                    if (!finalGrid[r][c].isActive) continue;

                    // Check if this cell is the starting position of any placed words
                    let startsHere = placed.filter(p => p.x === c && p.y === r);
                    if (startsHere.length > 0) {
                        finalGrid[r][c].number = numberCounter;
                        startsHere.forEach(p => {
                            p.number = numberCounter;
                        });
                        numberCounter++;
                    }
                }
            }

            // Link cells back to words they belong to
            placed.forEach(p => {
                for (let i = 0; i < p.word.length; i++) {
                    const cx = (p.direction === 'across') ? p.x + i : p.x;
                    const cy = (p.direction === 'across') ? p.y : p.y + i;
                    finalGrid[cy][cx].words.push(p.id);
                }
            });

            // Group clues by direction and sort by index
            const acrossClues = placed.filter(p => p.direction === 'across').sort((a, b) => a.number - b.number);
            const downClues = placed.filter(p => p.direction === 'down').sort((a, b) => a.number - b.number);

            return {
                gridCells: finalGrid,
                placed: placed,
                acrossClues: acrossClues,
                downClues: downClues
            };
        };

        const checkPlacementValidity = (grid, word, startX, startY, direction, GRID_SIZE) => {
            const len = word.length;

            // Bounds check
            if (startX < 1 || startY < 1 || startX + (direction === 'across' ? len : 0) >= GRID_SIZE - 1 || startY + (direction === 'down' ? len : 0) >= GRID_SIZE - 1) {
                return false;
            }

            // Check padding before and after word bounds
            if (direction === 'across') {
                if (grid[startY][startX - 1] !== null) return false;
                if (grid[startY][startX + len] !== null) return false;
            } else {
                if (grid[startY - 1][startX] !== null) return false;
                if (grid[startY + len][startX] !== null) return false;
            }

            let hasIntersection = false;

            for (let i = 0; i < len; i++) {
                let cx = (direction === 'across') ? startX + i : startX;
                let cy = (direction === 'across') ? startY : startY + i;
                let char = word[i];
                let cellVal = grid[cy][cx];

                if (cellVal !== null) {
                    if (cellVal !== char) return false; // character mismatch
                    hasIntersection = true;
                } else {
                    // Check parallel adjacent cells for invalid letters
                    if (direction === 'across') {
                        if (grid[cy - 1][cx] !== null || grid[cy + 1][cx] !== null) return false;
                    } else {
                        if (grid[cy][cx - 1] !== null || grid[cy][cx + 1] !== null) return false;
                    }
                }
            }

            return hasIntersection;
        };

        const calculatePlacementScore = (grid, word, startX, startY, direction, GRID_SIZE) => {
            let score = 100;
            let intersections = 0;
            const len = word.length;

            for (let i = 0; i < len; i++) {
                const cx = (direction === 'across') ? startX + i : startX;
                const cy = (direction === 'across') ? startY : startY + i;
                if (grid[cy][cx] !== null) {
                    intersections++;
                }
            }

            score += intersections * 200;

            // Distance penalty: keep layout compact around grid center
            const center = GRID_SIZE / 2;
            const dist = Math.abs(startX - center) + Math.abs(startY - center);
            score -= dist * 2;

            return score;
        };

        // --- 🎛️ Canvas Pan & Zoom ---
        const startPanning = (e) => {
            // Don't start panning when clicking on an input cell
            if (e.target.tagName === 'INPUT') return;
            isDragging.value = true;
            _panStartX = e.clientX;
            _panStartY = e.clientY;
            _panOriginX = panX.value;
            _panOriginY = panY.value;
            e.currentTarget.setPointerCapture(e.pointerId);
        };

        const panning = (e) => {
            if (!isDragging.value) return;
            panX.value = _panOriginX + (e.clientX - _panStartX);
            panY.value = _panOriginY + (e.clientY - _panStartY);
        };

        const stopPanning = (e) => {
            if (!isDragging.value) return;
            isDragging.value = false;
        };

        const handleZoom = (e) => {
            const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
            const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomScale.value + delta));

            // Zoom centered on cursor position within the viewport
            const vp = canvasViewport.value;
            if (!vp) { zoomScale.value = newScale; return; }
            const rect = vp.getBoundingClientRect();
            const mx = e.clientX - rect.left; // mouse X relative to viewport
            const my = e.clientY - rect.top;

            // Adjust pan so the point under cursor stays fixed
            panX.value = mx - (mx - panX.value) * (newScale / zoomScale.value);
            panY.value = my - (my - panY.value) * (newScale / zoomScale.value);
            zoomScale.value = newScale;
        };

        const zoomIn = () => {
            const newScale = Math.min(ZOOM_MAX, zoomScale.value + ZOOM_STEP);
            const vp = canvasViewport.value;
            if (vp) {
                const cx = vp.clientWidth / 2;
                const cy = vp.clientHeight / 2;
                panX.value = cx - (cx - panX.value) * (newScale / zoomScale.value);
                panY.value = cy - (cy - panY.value) * (newScale / zoomScale.value);
            }
            zoomScale.value = newScale;
        };

        const zoomOut = () => {
            const newScale = Math.max(ZOOM_MIN, zoomScale.value - ZOOM_STEP);
            const vp = canvasViewport.value;
            if (vp) {
                const cx = vp.clientWidth / 2;
                const cy = vp.clientHeight / 2;
                panX.value = cx - (cx - panX.value) * (newScale / zoomScale.value);
                panY.value = cy - (cy - panY.value) * (newScale / zoomScale.value);
            }
            zoomScale.value = newScale;
        };

        const zoomReset = () => {
            centerGrid();
        };

        const centerGrid = () => {
            // Compute grid pixel size and center it inside the viewport
            if (gridCells.value.length === 0) return;
            const rows = gridCells.value.length;
            const cols = gridCells.value[0].length;
            const CELL = 44; // cell px + gap
            const gridW = cols * CELL;
            const gridH = rows * CELL;

            nextTick(() => {
                const vp = canvasViewport.value;
                if (!vp) return;
                const vpW = vp.clientWidth;
                const vpH = vp.clientHeight;
                // Reset to scale=1 and center
                zoomScale.value = 1.0;
                panX.value = (vpW - gridW) / 2;
                panY.value = (vpH - gridH) / 2;
            });
        };

        const toggleRevealMode = () => {
            revealMode.value = !revealMode.value;
            if (revealMode.value) {
                showToast('👁️ Reveal Mode ON - Double click a cell to reveal the letter', 'warning');
            } else {
                showToast('🔒 Reveal Mode OFF', 'info');
            }
        };

        const revealCell = (row, col) => {
            if (!revealMode.value) return;
            const cell = gridCells.value[row][col];
            if (!cell || !cell.isActive) return;
            if (cell.revealed) return; // already revealed
            cell.guess = cell.char;
            cell.revealed = true;
            cell.checked = true;
            cell.isCorrect = true;
            revealCount.value++;
            // Focus the input briefly to show the letter
            nextTick(() => {
                const el = document.getElementById(`cell-input-${row}-${col}`);
                if (el) el.focus();
            });
        };

        const resetGuesses = () => {
            if (!confirm('Are you sure you want to clear all your answers in the grid?')) return;
            gridCells.value.forEach(row => {
                row.forEach(cell => {
                    if (cell.isActive) {
                        cell.guess = '';
                        cell.checked = false;
                        cell.isCorrect = false;
                        cell.revealed = false;
                    }
                });
            });
            revealCount.value = 0;
            showToast('🔄 Answers cleared', 'info');
        };


        const resetGameSetup = () => {
            gameState.value = 'setup';
            placedWords.value = [];
            gridCells.value = [];
            acrossClues.value = [];
            downClues.value = [];
            activeRow.value = -1;
            activeCol.value = -1;
            // Reset canvas transform
            panX.value = 0;
            panY.value = 0;
            zoomScale.value = 1.0;
            // Reset reveal & timer
            revealMode.value = false;
            revealCount.value = 0;
            stopTimer();
            timerSeconds.value = 0;
        };

        const checkAnswers = () => {
            let allCorrect = true;
            let totalActiveCells = 0;
            let emptyCells = 0;

            gridCells.value.forEach(row => {
                row.forEach(cell => {
                    if (cell.isActive) {
                        totalActiveCells++;
                        const guessChar = cell.guess.trim().toUpperCase();
                        const correctChar = cell.char.toUpperCase();

                        if (!guessChar) {
                            emptyCells++;
                            allCorrect = false;
                            cell.checked = false;
                        } else {
                            cell.checked = true;
                            cell.isCorrect = (guessChar === correctChar);
                            if (!cell.isCorrect) {
                                allCorrect = false;
                            }
                        }
                    }
                });
            });

            if (emptyCells === totalActiveCells) {
                showToast('⚠️ Please fill in some letters before checking answers', 'warning');
                return;
            }

            if (allCorrect) {
                gameState.value = 'completed';
                stopTimer();
                showToast('🏆 Excellent! All answers are correct!', 'success');
            } else {
                if (emptyCells > 0) {
                    showToast('❌ Some answers are incorrect, and there are empty cells left', 'error');
                } else {
                    showToast('❌ Some answers are incorrect. Please correct the highlighted cells.', 'error');
                }
            }
        };

        // Cell focus and navigation
        const focusCell = (r, c) => {
            const cell = gridCells.value[r][c];
            if (!cell || !cell.isActive) return;

            // If same cell clicked, toggle typing direction
            if (activeRow.value === r && activeCol.value === c) {
                activeDirection.value = (activeDirection.value === 'across') ? 'down' : 'across';
            } else {
                activeRow.value = r;
                activeCol.value = c;

                // Set active direction based on matching words in cell
                if (cell.words.length > 0) {
                    // Try to keep current direction if cell is part of a word in that direction
                    const wordIds = cell.words;
                    const matchingWords = placedWords.value.filter(p => wordIds.includes(p.id));
                    const hasCurrentDirection = matchingWords.some(p => p.direction === activeDirection.value);

                    if (!hasCurrentDirection && matchingWords.length > 0) {
                        activeDirection.value = matchingWords[0].direction;
                    }
                }
            }

            // Native focus on input
            nextTick(() => {
                const inputEl = document.getElementById(`cell-input-${r}-${c}`);
                if (inputEl) inputEl.focus();
            });
        };

        const isCellFocused = (r, c) => {
            return activeRow.value === r && activeCol.value === c;
        };

        const isCellInActiveWord = (r, c) => {
            if (activeRow.value === -1 || activeCol.value === -1) return false;
            const currentCell = gridCells.value[activeRow.value][activeCol.value];
            if (!currentCell) return false;

            const targetCell = gridCells.value[r][c];
            if (!targetCell || !targetCell.isActive) return false;

            // Intersecting words
            const commonWords = currentCell.words.filter(wId => targetCell.words.includes(wId));
            if (commonWords.length === 0) return false;

            // Find the word of matching direction
            const matchedWord = placedWords.value.find(p => commonWords.includes(p.id) && p.direction === activeDirection.value);
            return !!matchedWord;
        };

        const isClueActive = (clue) => {
            if (activeRow.value === -1 || activeCol.value === -1) return false;
            const currentCell = gridCells.value[activeRow.value][activeCol.value];
            if (!currentCell) return false;
            return currentCell.words.includes(clue.id) && activeDirection.value === clue.direction;
        };

        const isClueFilled = (clue) => {
            // Check if all cells of this word have inputs
            for (let i = 0; i < clue.word.length; i++) {
                const cx = (clue.direction === 'across') ? clue.x + i : clue.x;
                const cy = (clue.direction === 'across') ? clue.y : clue.y + i;
                const cell = gridCells.value[cy][cx];
                if (!cell.guess.trim()) return false;
            }
            return true;
        };

        const selectClue = (clue) => {
            activeDirection.value = clue.direction;
            focusCell(clue.y, clue.x);
        };

        const handleCellKeydown = (e, r, c) => {
            const key = e.key;

            // Arrow key movements
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
                e.preventDefault();
                let nextR = r;
                let nextC = c;

                if (key === 'ArrowUp') { nextR--; activeDirection.value = 'down'; }
                if (key === 'ArrowDown') { nextR++; activeDirection.value = 'down'; }
                if (key === 'ArrowLeft') { nextC--; activeDirection.value = 'across'; }
                if (key === 'ArrowRight') { nextC++; activeDirection.value = 'across'; }

                if (gridCells.value[nextR] && gridCells.value[nextR][nextC] && gridCells.value[nextR][nextC].isActive) {
                    focusCell(nextR, nextC);
                }
                return;
            }

            // Backspace key
            if (key === 'Backspace') {
                e.preventDefault();
                const cell = gridCells.value[r][c];
                cell.guess = '';
                cell.checked = false;

                // Move cursor backward along direction
                let nextR = (activeDirection.value === 'down') ? r - 1 : r;
                let nextC = (activeDirection.value === 'across') ? c - 1 : c;

                if (gridCells.value[nextR] && gridCells.value[nextR][nextC] && gridCells.value[nextR][nextC].isActive) {
                    focusCell(nextR, nextC);
                }
                return;
            }

            // Regular printable keys
            if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                const cell = gridCells.value[r][c];
                cell.guess = key.toUpperCase();
                cell.checked = false;

                // Move cursor forward along direction
                let nextR = (activeDirection.value === 'down') ? r + 1 : r;
                let nextC = (activeDirection.value === 'across') ? c + 1 : c;

                if (gridCells.value[nextR] && gridCells.value[nextR][nextC] && gridCells.value[nextR][nextC].isActive) {
                    focusCell(nextR, nextC);
                }
            }
        };

        // --- Life Cycle Hooks ---
        // --- 🔗 Hash-based admin routing ---
        const applyHashRoute = () => {
            const hash = window.location.hash.replace('#', '').toLowerCase();
            if (hash === 'admin') {
                viewMode.value = 'admin';
                activeTab.value = 'crosswords';
                fetchCrosswordDirs();
            }
        };

        // --- Rankings Operations ---
        const formatSeconds = (sec) => {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return `${m}:${String(s).padStart(2, '0')}`;
        };

        const selectedDirsDisplay = computed(() => {
            if (selectedPlayDirs.value.length === 0) return 'No category selected';
            return selectedPlayDirs.value.join(' + ');
        });

        const fetchRankings = async () => {
            rankingLoading.value = true;
            try {
                let url = `${API_URL}/rankings`;
                if (rankingFilter.value === 'selected' && selectedPlayDirs.value.length > 0) {
                    const labsKey = selectedPlayDirs.value.slice().sort().join('+');
                    url += `?labsKey=${encodeURIComponent(labsKey)}`;
                }
                const response = await fetch(url);
                const data = await response.json();
                if (data.success) {
                    rankingList.value = data.data;
                }
            } catch (e) {
                console.error('Failed to fetch rankings:', e);
            } finally {
                rankingLoading.value = false;
            }
        };

        const submitScore = async () => {
            const name = rankingForm.playerName.trim();
            if (!name) {
                showToast('⚠️ Please enter your player name before saving', 'warning');
                return;
            }
            if (selectedPlayDirs.value.length === 0) return;

            submittingScore.value = true;
            try {
                // Determine which avatar to send
                const playerAvatar = currentUser.value
                    ? (currentUser.value.avatar || 'avatar1')
                    : guestAvatar.value;

                const payload = {
                    playerName: name,
                    playerAvatar,
                    labs: selectedPlayDirs.value,
                    wordCount: placedWords.value.length,
                    time: timerSeconds.value
                };

                const response = await fetch(`${API_URL}/rankings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();

                if (data.success) {
                    showToast('🏆 Score saved to leaderboard!', 'success');
                    scoreSubmitted.value = true;
                } else {
                    showToast(`❌ Failed to save score: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ Connection error while saving score', 'error');
            } finally {
                submittingScore.value = false;
            }
        };

        const backToSetupAfterPlay = () => {
            resetGameSetup();
            scoreSubmitted.value = false;
            fetchRankings();
        };

        onMounted(() => {
            checkHealth();
            setInterval(checkHealth, 10000);
            fetchUserProfile();
            fetchCrosswordDirs();
            fetchNotes();
            // Route based on URL hash (e.g. /#admin)
            applyHashRoute();
            window.addEventListener('hashchange', applyHashRoute);

            // Fetch initial rankings
            fetchRankings();
        });

        return {
            viewMode,
            activeTab,
            currentUser,
            currentNotes,
            notesLoading,
            showForm,
            serviceStatus,
            noteForm,
            authForm,
            toast,
            toastBorderColor,
            formatDate,
            canEdit,
            showToast,
            switchTab,
            statusClass,
            checkHealth,
            handleLogin,
            handleRegister,
            logout,
            fetchNotes,
            showNoteForm,
            hideNoteForm,
            saveNote,
            editNote,
            deleteNote,

            // Crossword Admin States & Actions
            crosswordDirs,
            dirsLoading,
            newDirName,
            selectedAdminDir,
            uploadTargetDir,
            isDragOver,
            selectedFileName,
            parsedFileWords,
            createDirectory,
            deleteDirectory,
            selectAdminDir,
            onDragOver,
            onDragLeave,
            triggerFileInput,
            onFileSelected,
            onDropFile,
            clearParsedFile,
            submitUploadedWords,

            // Crossword Play States & Actions
            gameState,
            showCluesModal,
            revealMode,
            revealCount,
            timerDisplay,
            toggleRevealMode,
            revealCell,
            playConfig,
            maxAvailableWords,
            requestedCount,
            placedWords,
            gridCells,
            acrossClues,
            downClues,
            gridBoardStyle,
            startGame,
            resetGuesses,
            resetGameSetup,
            checkAnswers,
            focusCell,
            isCellFocused,
            isCellInActiveWord,
            isClueActive,
            isClueFilled,
            selectClue,
            handleCellKeydown,
            switchViewMode,

            // Canvas pan/zoom
            canvasViewport,
            panX,
            panY,
            zoomScale,
            isDragging,
            startPanning,
            panning,
            stopPanning,
            handleZoom,
            zoomIn,
            zoomOut,
            zoomReset,

            // New Play & Rankings states/actions
            selectedPlayDirs,
            rankingFilter,
            rankingList,
            rankingLoading,
            scoreSubmitted,
            submittingScore,
            rankingForm,
            toggleSelectPlayDir,
            formatSeconds,
            selectedDirsDisplay,
            submitScore,
            backToSetupAfterPlay,
            formatRankDate,

            // Profile / Auth
            showProfileModal,
            showAuthModal,
            authModalTab,
            changingPassword,
            guestName,
            guestAvatar,
            avatarOptions,
            profileForm,
            getAvatarSvg,
            getAvatarDisplay,
            onAvatarFileSelected,
            openProfileModal,
            openAuthModal,
            saveGuestName,
            selectAvatar,
            applyCustomAvatar,
            changePassword,
            handleLoginModal,
            handleRegisterModal,
            logoutPlayer
        };
    }
}).mount('#app');
