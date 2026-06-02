const { createApp, ref, reactive, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        const API_URL = '/api';

        // --- States ---
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
            window.location.hash = tabId;
        };

        const statusClass = (status) => {
            return {
                'status-ok': status === 'ok',
                'status-pending': status === 'pending',
                'status-error': status === 'error'
            };
        };

        // --- 🌐 Health Monitoring ---
        const checkHealth = async () => {
            serviceStatus.nginx = 'ok';
            try {
                const response = await fetch(`${API_URL}/health`, { credentials: 'include' });
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
                const response = await fetch(`${API_URL}/auth/profile`, { credentials: 'include' });
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
                    body: JSON.stringify({ username, password }),
                    credentials: 'include'
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
                    body: JSON.stringify({ username, password }),
                    credentials: 'include'
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
                const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
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

        // --- 📝 Notes CRUD ---
        const fetchNotes = async () => {
            notesLoading.value = true;
            try {
                const response = await fetch(`${API_URL}/notes`, { credentials: 'include' });
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
                    body: JSON.stringify(notePayload),
                    credentials: 'include'
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
                const response = await fetch(`${API_URL}/notes/${noteId}`, { method: 'DELETE', credentials: 'include' });
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
                const response = await fetch(`${API_URL}/crosswords/directories`, { credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    crosswordDirs.value = data.data;
                }
            } catch (e) {
                showToast('❌ Failed to fetch crossword categories', 'error');
            } finally {
                dirsLoading.value = false;
            }
        };

        const createDirectory = async () => {
            if (!newDirName.value.trim()) return;
            try {
                const response = await fetch(`${API_URL}/crosswords/directories`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newDirName.value.trim() }),
                    credentials: 'include'
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
                    method: 'DELETE',
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    showToast('🗑️ Category deleted successfully', 'success');
                    if (selectedAdminDir.value === name) selectedAdminDir.value = '';
                    if (uploadTargetDir.value === name) uploadTargetDir.value = '';
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
                    const cleanWord = cells[0].toUpperCase().replace(/[\s\-_,\.\(\)\[\]"']/g, '');
                    if (cleanWord.length >= 2) {
                        results.push({
                            word: cleanWord,
                            clue: cells[1],
                            clue2: cells[2] || '' // Add Column 3 as clue2
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
                    }),
                    credentials: 'include'
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

        // --- 🔗 Hash-based admin routing ---
        const applyHashRoute = () => {
            const hash = window.location.hash.replace('#', '').toLowerCase();
            if (hash === 'notes') {
                activeTab.value = 'notes';
                fetchNotes();
            } else if (hash === 'auth') {
                activeTab.value = 'auth';
            } else {
                activeTab.value = 'crosswords';
                fetchCrosswordDirs();
            }
        };

        onMounted(() => {
            checkHealth();
            setInterval(checkHealth, 10000);
            fetchUserProfile();
            fetchCrosswordDirs();
            fetchNotes();
            applyHashRoute();
            window.addEventListener('hashchange', applyHashRoute);
        });

        const getAvatarDisplay = (av) => {
            if (!av) av = 'avatar1';
            if (av.startsWith('data:') || av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
            }
            // Simple preset SVGs
            const AVATAR_COLORS = [
                ['#7c3aed','#ede9fe'], ['#db2777','#fce7f3'], ['#0891b2','#cffafe'],
                ['#d97706','#fef3c7'], ['#059669','#d1fae5'], ['#dc2626','#fee2e2']
            ];
            const AVATAR_SYMBOLS = ['😺','🦊','🐧','🦁','🐸','🦄'];
            const idx = parseInt(av.replace('avatar','')) - 1;
            const safeIdx = Math.max(0, Math.min(5, isNaN(idx) ? 0 : idx));
            const [bg] = AVATAR_COLORS[safeIdx];
            const sym = AVATAR_SYMBOLS[safeIdx];
            return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><circle cx="20" cy="20" r="20" fill="${bg}"/><text x="20" y="27" text-anchor="middle" font-size="20">${sym}</text></svg>`;
        };

        return {
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

            // Crossword Admin
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
            getAvatarDisplay
        };
    }
}).mount('#app');
