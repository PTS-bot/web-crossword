const { createApp, ref, reactive, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        const API_URL = '/api';

        // --- States ---
        const activeTab = ref('dashboard');
        const currentUser = ref(null);
        const currentNotes = ref([]);
        const notesLoading = ref(true);
        const showForm = ref(false);

        // Health Status Check
        const serviceStatus = reactive({
            nginx: 'ok',
            backend: 'pending',
            database: 'pending'
        });

        // Form Fields
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

        // Helper: Format date
        const formatDate = (dateStr) => {
            return new Date(dateStr).toLocaleString();
        };

        // Helper: Check permission to edit/delete
        const canEdit = (note) => {
            if (!currentUser.value) {
                return note.createdBy === 'Guest';
            }
            return currentUser.value.role === 'admin' || note.createdBy === currentUser.value.username;
        };

        // Helper: Toast trigger
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

        // Helper: Switch active tab
        const switchTab = (tabId) => {
            activeTab.value = tabId;
            if (tabId === 'notes') {
                fetchNotes();
                hideNoteForm();
            }
        };

        // Helper: Map status keywords to classes
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
                const response = await fetch(`${API_URL}/health`);
                if (!response.ok) throw new Error('API server returned error');
                const data = await response.json();
                
                if (data.success) {
                    serviceStatus.backend = data.services.backend === 'running' ? 'ok' : 'error';
                    
                    if (data.services.database === 'connected') {
                        serviceStatus.database = 'ok';
                    } else if (data.services.database === 'connecting') {
                        serviceStatus.database = 'pending';
                    } else {
                        serviceStatus.database = 'error';
                    }
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
                    switchTab('dashboard');
                    fetchNotes(); // Reload notes
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
                    authForm.loginUsername = username; // Auto fill username in login box
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
                    switchTab('dashboard');
                    fetchNotes(); // Reload notes
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
                if (formCard) {
                    formCard.scrollIntoView({ behavior: 'smooth' });
                }
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
                const response = await fetch(`${API_URL}/notes/${noteId}`, {
                    method: 'DELETE'
                });
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

        // --- 🚀 Life Cycle Hooks ---
        onMounted(() => {
            checkHealth();
            setInterval(checkHealth, 10000);
            fetchUserProfile();
            fetchNotes();
        });

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
            deleteNote
        };
    }
}).mount('#app');
