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
            } else {
                gameState.value = 'setup';
                fetchCrosswordDirs();
            }
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
                    
                    // Sync play dropdown selection
                    if (crosswordDirs.value.length > 0 && !playConfig.directory) {
                        playConfig.directory = crosswordDirs.value[0].name;
                        onPlayDirChange();
                    }
                }
            } catch (e) {
                showToast('❌ ไม่สามารถดึงข้อมูลหมวดหมู่ได้', 'error');
            } finally {
                dirsLoading.value = false;
            }
        };

        // Track how many words exist in selected category to prevent selecting more than available
        const onPlayDirChange = async () => {
            if (!playConfig.directory) return;
            try {
                const response = await fetch(`${API_URL}/crosswords/words?directory=${playConfig.directory}`);
                const data = await response.json();
                if (data.success) {
                    maxAvailableWords.value = data.data.length;
                    if (playConfig.wordCount > maxAvailableWords.value) {
                        playConfig.wordCount = Math.max(3, maxAvailableWords.value);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };

        // Watch playConfig.directory
        Vue.watch(() => playConfig.directory, () => {
            onPlayDirChange();
        });

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
                    showToast(`✅ สร้างหมวดหมู่ '${newDirName.value}' สำเร็จ!`, 'success');
                    newDirName.value = '';
                    fetchCrosswordDirs();
                } else {
                    showToast(`❌ สร้างหมวดหมู่ล้มเหลว: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ มีปัญหาการเชื่อมต่อเซิร์ฟเวอร์', 'error');
            }
        };

        const deleteDirectory = async (name) => {
            if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ '${name}' และคำศัพท์ทั้งหมดข้างใน? การกระทำนี้ไม่สามารถย้อนคืนได้`)) return;
            try {
                const response = await fetch(`${API_URL}/crosswords/directories/${name}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (data.success) {
                    showToast('🗑️ ลบหมวดหมู่เรียบร้อยแล้ว', 'success');
                    if (selectedAdminDir.value === name) selectedAdminDir.value = '';
                    if (uploadTargetDir.value === name) uploadTargetDir.value = '';
                    if (playConfig.directory === name) playConfig.directory = '';
                    fetchCrosswordDirs();
                } else {
                    showToast(`❌ ลบล้มเหลว: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ มีปัญหาการเชื่อมต่อเซิร์ฟเวอร์', 'error');
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
                showToast('❌ รองรับเฉพาะไฟล์นามสกุล .csv เท่านั้น', 'error');
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
                showToast('⚠️ ไม่พบข้อมูลคำศัพท์ที่ถูกต้องในไฟล์ CSV', 'warning');
            } else {
                showToast(`📊 อ่านไฟล์สำเร็จ พบคำศัพท์ ${results.length} คำ`, 'success');
            }
        };

        const clearParsedFile = () => {
            selectedFileName.value = '';
            parsedFileWords.value = [];
        };

        const submitUploadedWords = async () => {
            if (!uploadTargetDir.value) {
                showToast('⚠️ กรุณาเลือกหมวดหมู่ที่ต้องการบันทึก', 'warning');
                return;
            }
            if (parsedFileWords.value.length === 0) {
                showToast('⚠️ ไม่มีคำศัพท์ที่จะบันทึก', 'warning');
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
                    showToast(`✅ นำเข้าข้อมูล ${data.count} คำ ลงหมวดหมู่ '${uploadTargetDir.value}' สำเร็จ!`, 'success');
                    clearParsedFile();
                    fetchCrosswordDirs();
                } else {
                    showToast(`❌ อัปโหลดล้มเหลว: ${data.message}`, 'error');
                }
            } catch (e) {
                showToast('❌ เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว', 'error');
            }
        };


        // --- 🎮 Crossword Game Generator & Interface logic ---

        const startGame = async () => {
            if (!playConfig.directory) return;
            try {
                const response = await fetch(`${API_URL}/crosswords/words?directory=${playConfig.directory}`);
                const data = await response.json();
                if (!data.success || data.data.length === 0) {
                    showToast('❌ ไม่สามารถเริ่มเกมได้ เนื่องจากไม่พบคำศัพท์ในหมวดหมู่นี้', 'error');
                    return;
                }

                rawDirectoryWords.value = data.data;
                requestedCount.value = playConfig.wordCount;
                
                // Build crossword grid layout
                const generated = generateCrossword(data.data, playConfig.wordCount);
                if (!generated || generated.placed.length === 0) {
                    showToast('⚠️ ไม่สามารถเชื่อมโยงคำศัพท์เป็นตารางได้สำเร็จ กรุณาลองใหม่อีกครั้งหรือเพิ่มคำศัพท์ในระบบ', 'warning');
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
                showToast('❌ มีข้อผิดพลาดในการโหลดโจทย์เล่นเกม', 'error');
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
                showToast('👁️ โหมดเฉลย ON — ดับเบิลคลิกที่ช่องเพื่อเปิดเฉลยตัวอักษร', 'warning');
            } else {
                showToast('🔒 ปิดโหมดเฉลยแล้ว', 'info');
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
            if (!confirm('คุณต้องการรีเซ็ตอักษรที่พิมพ์ลงไปทั้งหมดในตารางใช่หรือไม่?')) return;
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
            showToast('🔄 ล้างข้อมูลตัวอักษรเรียบร้อยแล้ว', 'info');
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
                showToast('⚠️ กรุณาพิมพ์ตัวอักษรลงในตารางก่อนตรวจคำตอบ', 'warning');
                return;
            }

            if (allCorrect) {
                gameState.value = 'completed';
                stopTimer();
                showToast('🏆 ยอดเยี่ยม! คุณตอบคำถามถูกต้องทั้งหมด!', 'success');
            } else {
                if (emptyCells > 0) {
                    showToast('❌ ตรวจสอบแล้ว พบตัวอักษรที่ผิด และยังมีช่องว่างที่เติมไม่ครบ', 'error');
                } else {
                    showToast('❌ พบตัวอักษรที่ไม่ถูกต้องในตาราง กรุณาแก้ไขตามสีที่แสดง', 'error');
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
        onMounted(() => {
            checkHealth();
            setInterval(checkHealth, 10000);
            fetchUserProfile();
            fetchCrosswordDirs();
            fetchNotes();
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
            zoomReset
        };
    }
}).mount('#app');
