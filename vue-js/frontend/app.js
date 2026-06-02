const { createApp, ref, reactive, onMounted, computed, nextTick, watch } = Vue;

createApp({
    setup() {
        const API_URL = '/api';

        // --- States ---
        const currentUser = ref(null);

        // Crossword Play States
        const gameState = ref('setup'); // 'setup', 'playing', 'completed'
        const showCluesModal = ref(false);
        const revealMode = ref(false);   // toggle to allow dblclick reveal
        const revealCount = ref(0);      // how many cells have been revealed
        const useSecondLang = ref(false); // second language mode (safety switch inside game)
        const leaderboardFilterSecondLang = ref(false); // filters rankings for (2) games
        const leaderboardShowGuests = ref(true); // show guest players on the leaderboard
        const hasOpenedSecondLang = ref(false); // tracks if user flipped at least one clue
        const flippedClues = reactive({}); // tracks individual flipped clues: { [clueId]: boolean }

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

        // Play and ranking states
        const crosswordDirs = ref([]);
        const dirsLoading = ref(true);
        const selectedPlayDirs = ref([]); // array of selected directory names
        const rankingFilter = ref('all'); // 'selected' or 'all'
        const rankingList = ref([]);
        const rankingLoading = ref(false);
        const scoreSubmitted = ref(false);
        const submittingScore = ref(false);
        const showCompletionOverlay = ref(false);
        const solvedWords = ref([]); // { word, clue, clue2, solvedAt }
        const rankingForm = reactive({
            playerName: ''
        });

        // Profile Modal states
        const showProfileModal = ref(false);
        const showAuthModal = ref(false);
        const authModalTab = ref('login');
        const changingPassword = ref(false);

        // Profile Dashboard States
        const profileActiveTab = ref('dashboard');
        const profileSelectedMetric = ref('score');
        const myScores = ref([]);
        const allScores = ref([]);
        const profileLoading = ref(false);
        let profileChartInstance = null;

        const metrics = [
            { key: 'score', label: 'Words per Second', unit: 'w/s', icon: 'fa-tachometer-alt' },
            { key: 'wordCount', label: 'Words Solved', unit: 'words', icon: 'fa-puzzle-piece' },
            { key: 'revealsUsed', label: 'Clues Used', unit: 'times', icon: 'fa-eye' },
            { key: 'time', label: 'Time Taken', unit: 'sec', icon: 'fa-clock' }
        ];

        const activeProfileMetricInfo = computed(() => {
            return metrics.find(m => m.key === profileSelectedMetric.value) || metrics[0];
        });

        const formatProfileMetricValue = (val) => {
            if (val === undefined || val === null) return '0.00';
            return val.toFixed(2);
        };

        const profileUserStats = computed(() => {
            let userScores = myScores.value;
            if (selectedPlayDirs.value.length > 0) {
                userScores = userScores.filter(s => s.labs && s.labs.some(l => selectedPlayDirs.value.includes(l)));
            }
            if (userScores.length === 0) return { rounds: 0, avg: 0, max: 0 };

            const metricKey = profileSelectedMetric.value;
            const scores = userScores.map(s => s[metricKey] !== undefined ? s[metricKey] : 0);
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const max = Math.max(...scores);
            return { rounds: userScores.length, avg, max };
        });

        const fetchProfileDashboardData = async () => {
            profileLoading.value = true;
            try {
                const name = currentUser.value ? currentUser.value.username : guestName.value;
                const response = await fetch(`${API_URL}/my-scores?playerName=${encodeURIComponent(name || 'Guest')}`, { credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    myScores.value = data.myScores;
                    allScores.value = data.allScores;
                }
            } catch (err) {
                console.error('Failed to fetch profile dashboard data:', err);
            } finally {
                profileLoading.value = false;
            }
        };

        const switchProfileTab = async (tabName) => {
            profileActiveTab.value = tabName;
            if (tabName === 'dashboard') {
                await fetchProfileDashboardData();
                await nextTick();
                updateProfileChart();
            }
        };

        const changeProfileMetric = (key) => {
            profileSelectedMetric.value = key;
            updateProfileChart();
        };

        const updateProfileChart = () => {
            const canvas = document.getElementById('profileChart');
            if (!canvas) return;

            if (profileChartInstance) {
                profileChartInstance.destroy();
                profileChartInstance = null;
            }

            const metricKey = profileSelectedMetric.value;
            const metricInfo = activeProfileMetricInfo.value;

            // Filter scores by selectedPlayDirs
            let activeMyScores = myScores.value;
            let activeAllScores = allScores.value;
            if (selectedPlayDirs.value.length > 0) {
                activeMyScores = activeMyScores.filter(s => s.labs && s.labs.some(l => selectedPlayDirs.value.includes(l)));
                activeAllScores = activeAllScores.filter(s => s.labs && s.labs.some(l => selectedPlayDirs.value.includes(l)));
            }

            // Build user sequence of metric values
            const myData = activeMyScores.map(s => s[metricKey] !== undefined ? s[metricKey] : 0);

            // Build group average per round
            const perUserScores = {};
            activeAllScores.forEach(s => {
                if (s.playerName && s.playerName.startsWith('Guest_')) return;
                if (!perUserScores[s.playerName]) perUserScores[s.playerName] = [];
                const val = s[metricKey] !== undefined ? s[metricKey] : 0;
                perUserScores[s.playerName].push(val);
            });

            // Find max rounds
            const maxRounds = Math.max(myData.length, ...Object.values(perUserScores).map(arr => arr.length), 0);
            if (maxRounds === 0) return;

            const avgPerRound = [];
            for (let round = 0; round < maxRounds; round++) {
                const vals = Object.values(perUserScores)
                    .map(arr => arr[round])
                    .filter(v => v !== undefined);
                avgPerRound.push(vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
            }

            const myDataPadded = Array.from({ length: maxRounds }, (_, i) =>
                i < myData.length ? myData[i] : null
            );

            // Labels
            const labels = Array.from({ length: maxRounds }, (_, i) => {
                const entry = activeMyScores[i];
                if (entry && entry.createdAt) {
                    const d = new Date(entry.createdAt);
                    return `Round ${i + 1} (${d.getDate()}/${d.getMonth()+1})`;
                }
                return `Round ${i + 1}`;
            });

            const ctx = canvas.getContext('2d');
            profileChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Your Progress',
                            data: myDataPadded,
                            borderColor: '#00d2ff',
                            backgroundColor: 'rgba(0, 210, 255, 0.1)',
                            borderWidth: 2,
                            pointBackgroundColor: '#00d2ff',
                            pointRadius: 4,
                            tension: 0.35,
                            fill: true
                        },
                        {
                            label: 'Group Average',
                            data: avgPerRound,
                            borderColor: '#a855f7',
                            backgroundColor: 'rgba(168, 85, 247, 0.05)',
                            borderWidth: 1.5,
                            borderDash: [5, 4],
                            pointBackgroundColor: '#a855f7',
                            pointRadius: 3,
                            tension: 0.35,
                            fill: false,
                            spanGaps: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: {
                                color: '#94a3b8',
                                font: { size: 10, family: 'Outfit, sans-serif' },
                                boxWidth: 12
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const v = ctx.parsed.y;
                                    return v !== null ? `${ctx.dataset.label}: ${v.toFixed(2)} ${metricInfo.unit}` : `${ctx.dataset.label}: —`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#94a3b8', font: { size: 9 } },
                            grid: { color: 'rgba(255,255,255,0.03)' }
                        },
                        y: {
                            ticks: { color: '#94a3b8', font: { size: 9 } },
                            grid: { color: 'rgba(255,255,255,0.03)' }
                        }
                    }
                }
            });
        };

        watch(showProfileModal, (newVal) => {
            if (!newVal && profileChartInstance) {
                profileChartInstance.destroy();
                profileChartInstance = null;
            }
        });

        // Guest identity (localStorage-persisted)
        const guestName = ref(localStorage.getItem('guestName') || '');
        const guestAvatar = ref(localStorage.getItem('guestAvatar') || 'avatar1');

        const avatarOptions = ['avatar1','avatar2','avatar3','avatar4','avatar5','avatar6'];

        const profileForm = reactive({
            guestName: guestName.value,
            customAvatarUrl: '',
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
            uploadFileName: ''
        });

        // Prefill ranking name if user is logged in
        watch(currentUser, (newVal) => {
            if (newVal) {
                rankingForm.playerName = newVal.username;
            } else {
                rankingForm.playerName = guestName.value || '';
            }
        }, { immediate: true });

        // Reset flipped clues if the 2nd language clues safety toggle is turned off
        watch(useSecondLang, (newVal) => {
            if (!newVal) {
                for (const key in flippedClues) {
                    flippedClues[key] = false;
                }
            }
        });

        // Prevent word count from going below 3 (or maxAvailableWords if less than 3)
        watch(() => playConfig.wordCount, (newVal) => {
            if (maxAvailableWords.value > 0) {
                const limit = Math.min(3, maxAvailableWords.value);
                if (newVal < limit) {
                    playConfig.wordCount = limit;
                }
            }
        });

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

        // Stats panel dragging state
        const statsPosition = reactive({ x: 0, y: 0 });
        const isDraggingStats = ref(false);
        let _statsDragStartX = 0;
        let _statsDragStartY = 0;
        let _statsDragOriginX = 0;
        let _statsDragOriginY = 0;

        // Solved Words panel dragging state
        const swpPosition = reactive({ x: 0, y: 0 });
        const isDraggingSWP = ref(false);
        let _swpDragStartX = 0;
        let _swpDragStartY = 0;
        let _swpDragOriginX = 0;
        let _swpDragOriginY = 0;

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

        const statsPanelStyle = computed(() => {
            return {
                transform: `translate(${statsPosition.x}px, ${statsPosition.y}px)`
            };
        });

        const swpPanelStyle = computed(() => {
            return {
                transform: `translate(${swpPosition.x}px, ${swpPosition.y}px)`
            };
        });

        // --- Helpers ---
        const formatDate = (dateStr) => {
            return new Date(dateStr).toLocaleString();
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

        // ── Avatar SVG generator ──────────────────────────────
        const AVATAR_COLORS = [
            ['#7c3aed','#ede9fe'], ['#db2777','#fce7f3'], ['#0891b2','#cffafe'],
            ['#d97706','#fef3c7'], ['#059669','#d1fae5'], ['#dc2626','#fee2e2']
        ];
        const AVATAR_SYMBOLS = ['😺','🦊','🐧','🦁','🐸','🦄'];

        const getAvatarSvg = (av) => {
            if (av && av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.src=''"/>`;
            }
            const idx = parseInt((av || 'avatar1').replace('avatar','')) - 1;
            const safeIdx = Math.max(0, Math.min(5, isNaN(idx) ? 0 : idx));
            const [bg] = AVATAR_COLORS[safeIdx];
            const sym = AVATAR_SYMBOLS[safeIdx];
            return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><circle cx="20" cy="20" r="20" fill="${bg}"/><text x="20" y="27" text-anchor="middle" font-size="20">${sym}</text></svg>`;
        };

        const getAvatarDisplay = (av) => {
            if (!av) av = 'avatar1';
            if (av.startsWith('data:') || av.startsWith('http')) {
                return `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
            }
            return getAvatarSvg(av);
        };

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
            event.target.value = '';
        };

        const openProfileModal = () => {
            profileForm.guestName = guestName.value;
            profileForm.customAvatarUrl = '';
            profileForm.currentPassword = '';
            profileForm.newPassword = '';
            profileForm.confirmPassword = '';
            profileActiveTab.value = currentUser.value ? 'dashboard' : 'settings';
            showProfileModal.value = true;
            if (currentUser.value) {
                fetchProfileDashboardData().then(async () => {
                    await nextTick();
                    updateProfileChart();
                });
            }
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
                        body: JSON.stringify({ avatar: av }),
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (data.success) {
                        currentUser.value = { ...currentUser.value, avatar: av };
                        showToast('🎨 Avatar updated!', 'success');
                    } else {
                        showToast(`❌ ${data.message}`, 'error');
                    }
                } catch(e) {
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
                    }),
                    credentials: 'include'
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
            } catch(e) {
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
                    body: JSON.stringify({ username, password }),
                    credentials: 'include'
                });
                const data = await response.json();
                if (data.success) {
                    showToast('✅ Logged in successfully!', 'success');
                    currentUser.value = data.user;
                    authForm.loginUsername = '';
                    authForm.loginPassword = '';
                    showAuthModal.value = false;
                    fetchCrosswordDirs();
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
                    body: JSON.stringify({ username, password }),
                    credentials: 'include'
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
                await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
            } catch(e) {}
            currentUser.value = null;
            showToast('🚪 Logged out successfully', 'info');
        };

        const formatRankDate = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

        // --- 🧩 Crossword Play logic ---
        const fetchCrosswordDirs = async () => {
            dirsLoading.value = true;
            try {
                const response = await fetch(`${API_URL}/crosswords/directories`, { credentials: 'include' });
                const data = await response.json();
                if (data.success) {
                    crosswordDirs.value = data.data;
                    
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

        const onSelectedDirsChange = async () => {
            if (selectedPlayDirs.value.length === 0) {
                maxAvailableWords.value = 0;
                playConfig.wordCount = 0;
                return;
            }
            try {
                const dirsParam = selectedPlayDirs.value.join(',');
                const response = await fetch(`${API_URL}/crosswords/words?directory=${encodeURIComponent(dirsParam)}`, { credentials: 'include' });
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

        // Watch for selected directories, filter tabs, language filters, or guest toggles to refresh rankings
        watch([rankingFilter, leaderboardFilterSecondLang, leaderboardShowGuests], () => {
            fetchRankings();
        });

        watch(selectedPlayDirs, (newVal) => {
            if (newVal.length > 0) {
                fetchRankings();
            } else {
                rankingList.value = [];
            }
        }, { deep: true });

        // --- 🎮 Crossword Game Generator & Interface logic ---
        const startGame = async () => {
            if (selectedPlayDirs.value.length === 0) return;
            try {
                const dirsParam = selectedPlayDirs.value.join(',');
                const response = await fetch(`${API_URL}/crosswords/words?directory=${encodeURIComponent(dirsParam)}`, { credentials: 'include' });
                const data = await response.json();
                if (!data.success || data.data.length === 0) {
                    showToast('❌ Cannot start game: No words found in the selected category', 'error');
                    return;
                }

                rawDirectoryWords.value = data.data;
                requestedCount.value = playConfig.wordCount;
                
                // Reset clue flip states
                useSecondLang.value = false;
                hasOpenedSecondLang.value = false;
                for (const key in flippedClues) {
                    delete flippedClues[key];
                }
                
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
                solvedWords.value = [];
                checkSolvedWords();

                nextTick(() => {
                    centerGrid();
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

        const generateCrossword = (wordsList, targetCount) => {
            let cleanList = wordsList.map(w => ({
                word: w.word.trim().toUpperCase().replace(/[\s\-_,\.\(\)\[\]"']/g, ''),
                clue: w.clue,
                clue2: w.clue2 || ''
            })).filter(w => w.word.length >= 2);

            if (cleanList.length === 0) return null;

            let bestRun = null;
            let maxPlacedCount = 0;
            let maxScore = -1;

            for (let run = 0; run < 25; run++) {
                let shuffled = [...cleanList].sort(() => Math.random() - 0.5);
                let selected = shuffled.slice(0, targetCount);
                selected.sort((a, b) => b.word.length - a.word.length);

                const GRID_SIZE = 60;
                let grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null));
                let placed = [];

                const firstWord = selected[0].word;
                const startX = Math.floor(GRID_SIZE / 2 - firstWord.length / 2);
                const startY = Math.floor(GRID_SIZE / 2);

                for (let i = 0; i < firstWord.length; i++) {
                    grid[startY][startX + i] = firstWord[i];
                }
                
                placed.push({
                    word: firstWord,
                    clue: selected[0].clue,
                    clue2: selected[0].clue2 || '',
                    x: startX,
                    y: startY,
                    direction: 'across'
                });

                for (let wIdx = 1; wIdx < selected.length; wIdx++) {
                    const currentItem = selected[wIdx];
                    const word = currentItem.word;
                    
                    let bestPositionForWord = null;
                    let highestScoreForWord = -Infinity;

                    for (let y = 0; y < GRID_SIZE; y++) {
                        for (let x = 0; x < GRID_SIZE; x++) {
                            const gridChar = grid[y][x];
                            if (!gridChar) continue;

                            let letterIdx = -1;
                            while ((letterIdx = word.indexOf(gridChar, letterIdx + 1)) !== -1) {
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

                    if (bestPositionForWord) {
                        for (let i = 0; i < word.length; i++) {
                            const cx = (bestPositionForWord.direction === 'across') ? bestPositionForWord.x + i : bestPositionForWord.x;
                            const cy = (bestPositionForWord.direction === 'across') ? bestPositionForWord.y : bestPositionForWord.y + i;
                            grid[cy][cx] = word[i];
                        }
                        placed.push({
                            word: word,
                            clue: currentItem.clue,
                            clue2: currentItem.clue2 || '',
                            x: bestPositionForWord.x,
                            y: bestPositionForWord.y,
                            direction: bestPositionForWord.direction
                        });
                    }
                }

                if (placed.length > maxPlacedCount) {
                    maxPlacedCount = placed.length;
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

            minX = Math.max(0, minX - 1);
            maxX = Math.min(GRID_SIZE - 1, maxX + 1);
            minY = Math.max(0, minY - 1);
            maxY = Math.min(GRID_SIZE - 1, maxY + 1);

            const croppedRows = maxY - minY + 1;
            const croppedCols = maxX - minX + 1;

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
                        revealed: false,
                        row: r,
                        col: c,
                        words: []
                    };
                });
            });

            placed.forEach((p, index) => {
                p.x = p.x - minX;
                p.y = p.y - minY;
                p.id = index;
            });

            let numberCounter = 1;
            for (let r = 0; r < croppedRows; r++) {
                for (let c = 0; c < croppedCols; c++) {
                    if (!finalGrid[r][c].isActive) continue;

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

            placed.forEach(p => {
                for (let i = 0; i < p.word.length; i++) {
                    const cx = (p.direction === 'across') ? p.x + i : p.x;
                    const cy = (p.direction === 'across') ? p.y : p.y + i;
                    finalGrid[cy][cx].words.push(p.id);
                }
            });

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
            if (startX < 1 || startY < 1 || startX + (direction === 'across' ? len : 0) >= GRID_SIZE - 1 || startY + (direction === 'down' ? len : 0) >= GRID_SIZE - 1) {
                return false;
            }
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
                    if (cellVal !== char) return false;
                    hasIntersection = true;
                } else {
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
            const center = GRID_SIZE / 2;
            const dist = Math.abs(startX - center) + Math.abs(startY - center);
            score -= dist * 2;
            return score;
        };

        // --- 🎛️ Canvas Pan & Zoom ---
        const startPanning = (e) => {
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
            const vp = canvasViewport.value;
            if (!vp) { zoomScale.value = newScale; return; }
            const rect = vp.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            panX.value = mx - (mx - panX.value) * (newScale / zoomScale.value);
            panY.value = my - (my - panY.value) * (newScale / zoomScale.value);
            zoomScale.value = newScale;
        };

        const zoomReset = () => {
            centerGrid();
        };

        // --- Dragging for Stats Panel ---
        const startStatsDrag = (e) => {
            isDraggingStats.value = true;
            
            const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
            const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
            
            _statsDragStartX = clientX;
            _statsDragStartY = clientY;
            _statsDragOriginX = statsPosition.x;
            _statsDragOriginY = statsPosition.y;
            
            if (e.type.startsWith('touch')) {
                window.addEventListener('touchmove', handleStatsDrag, { passive: false });
                window.addEventListener('touchend', stopStatsDrag);
            } else {
                window.addEventListener('mousemove', handleStatsDrag);
                window.addEventListener('mouseup', stopStatsDrag);
            }
        };

        const handleStatsDrag = (e) => {
            if (!isDraggingStats.value) return;
            
            const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
            const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
            
            const dx = clientX - _statsDragStartX;
            const dy = clientY - _statsDragStartY;
            
            statsPosition.x = _statsDragOriginX + dx;
            statsPosition.y = _statsDragOriginY + dy;
        };

        const stopStatsDrag = (e) => {
            if (!isDraggingStats.value) return;
            isDraggingStats.value = false;
            
            window.removeEventListener('mousemove', handleStatsDrag);
            window.removeEventListener('mouseup', stopStatsDrag);
            window.removeEventListener('touchmove', handleStatsDrag);
            window.removeEventListener('touchend', stopStatsDrag);
        };

        // --- Dragging for Solved Words Panel ---
        const startSWPDrag = (e) => {
            isDraggingSWP.value = true;
            const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
            const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
            _swpDragStartX = clientX;
            _swpDragStartY = clientY;
            _swpDragOriginX = swpPosition.x;
            _swpDragOriginY = swpPosition.y;
            if (e.type.startsWith('touch')) {
                window.addEventListener('touchmove', handleSWPDrag, { passive: false });
                window.addEventListener('touchend', stopSWPDrag);
            } else {
                window.addEventListener('mousemove', handleSWPDrag);
                window.addEventListener('mouseup', stopSWPDrag);
            }
        };

        const handleSWPDrag = (e) => {
            if (!isDraggingSWP.value) return;
            const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
            const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
            swpPosition.x = _swpDragOriginX + (clientX - _swpDragStartX);
            swpPosition.y = _swpDragOriginY + (clientY - _swpDragStartY);
        };

        const stopSWPDrag = (e) => {
            if (!isDraggingSWP.value) return;
            isDraggingSWP.value = false;
            window.removeEventListener('mousemove', handleSWPDrag);
            window.removeEventListener('mouseup', stopSWPDrag);
            window.removeEventListener('touchmove', handleSWPDrag);
            window.removeEventListener('touchend', stopSWPDrag);
        };

        const centerGrid = () => {
            if (gridCells.value.length === 0) return;
            const rows = gridCells.value.length;
            const cols = gridCells.value[0].length;
            const CELL = 44;
            const gridW = cols * CELL;
            const gridH = rows * CELL;

            nextTick(() => {
                const vp = canvasViewport.value;
                if (!vp) return;
                const vpW = vp.clientWidth;
                const vpH = vp.clientHeight;
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
            if (cell.revealed) return;
            cell.guess = cell.char;
            cell.revealed = true;
            cell.checked = true;
            cell.isCorrect = true;
            revealCount.value++;
            checkSolvedWords();
            checkAutoCompletion();
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
            checkSolvedWords();
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
            panX.value = 0;
            panY.value = 0;
            zoomScale.value = 1.0;
            revealMode.value = false;
            revealCount.value = 0;
            useSecondLang.value = false;
            hasOpenedSecondLang.value = false;
            showCompletionOverlay.value = false;
            solvedWords.value = [];
            swpPosition.x = 0;
            swpPosition.y = 0;
            for (const key in flippedClues) {
                delete flippedClues[key];
            }
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
                showCompletionOverlay.value = true;

                // Ensure all words are in the solvedWords list
                checkSolvedWords();

                showToast('🏆 Excellent! All answers are correct!', 'success');
            } else {
                if (emptyCells > 0) {
                    showToast('❌ Some answers are incorrect, and there are empty cells left', 'error');
                } else {
                    showToast('❌ Some answers are incorrect. Please correct the highlighted cells.', 'error');
                }
            }
        };

        const resumeTimer = () => {
            if (!_timerInterval && gameState.value === 'playing') {
                _timerInterval = setInterval(() => { timerSeconds.value++; }, 1000);
            }
        };

        const checkAutoCompletion = () => {
            if (gameState.value !== 'playing') return;
            
            let allCorrect = true;
            let totalActiveCells = 0;

            gridCells.value.forEach(row => {
                row.forEach(cell => {
                    if (cell.isActive) {
                        totalActiveCells++;
                        const guessChar = cell.guess.trim().toUpperCase();
                        const correctChar = cell.char.toUpperCase();

                        if (!guessChar || guessChar !== correctChar) {
                            allCorrect = false;
                        }
                    }
                });
            });

            if (totalActiveCells > 0 && allCorrect) {
                stopTimer();
            } else {
                resumeTimer();
            }
        };

        const handleBackClick = () => {
            let allCorrect = true;
            let totalActiveCells = 0;

            gridCells.value.forEach(row => {
                row.forEach(cell => {
                    if (cell.isActive) {
                        totalActiveCells++;
                        const guessChar = cell.guess.trim().toUpperCase();
                        const correctChar = cell.char.toUpperCase();

                        if (!guessChar || guessChar !== correctChar) {
                            allCorrect = false;
                        }
                    }
                });
            });

            if (totalActiveCells > 0 && allCorrect && !scoreSubmitted.value) {
                if (gameState.value === 'playing') {
                    showToast('🏆 Excellent! All answers are correct!', 'success');
                }
                gameState.value = 'completed';
                stopTimer();
                showCompletionOverlay.value = true;
                checkSolvedWords();
            } else {
                resetGameSetup();
            }
        };

        // Cell focus and navigation
        const focusCell = (r, c) => {
            const cell = gridCells.value[r][c];
            if (!cell || !cell.isActive) return;

            if (activeRow.value === r && activeCol.value === c) {
                // Only toggle direction if the cell belongs to both an across and a down word
                if (cell.words && cell.words.length > 0) {
                    const wordIds = cell.words;
                    const matchingWords = placedWords.value.filter(p => wordIds.includes(p.id));
                    const hasAcross = matchingWords.some(p => p.direction === 'across');
                    const hasDown = matchingWords.some(p => p.direction === 'down');
                    if (hasAcross && hasDown) {
                        activeDirection.value = (activeDirection.value === 'across') ? 'down' : 'across';
                    }
                }
            } else {
                activeRow.value = r;
                activeCol.value = c;
                
                if (cell.words && cell.words.length > 0) {
                    const wordIds = cell.words;
                    const matchingWords = placedWords.value.filter(p => wordIds.includes(p.id));
                    const hasCurrentDirection = matchingWords.some(p => p.direction === activeDirection.value);
                    
                    if (!hasCurrentDirection && matchingWords.length > 0) {
                        activeDirection.value = matchingWords[0].direction;
                    }
                }
            }

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

            const commonWords = currentCell.words.filter(wId => targetCell.words.includes(wId));
            if (commonWords.length === 0) return false;

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

        // Select clue and close modal
        const selectClueDirect = (clue) => {
            selectClue(clue);
            showCluesModal.value = false;
        };

        // 3D Card-flipping handler
        const handleClueClick = (event, clue) => {
            // Only flip card if player clicked the card itself (not the target direct select button)
            if (event.target.closest('.btn-select-clue')) return;
            if (!useSecondLang.value) {
                showToast('🔒 Please enable "2nd Language Clues" toggle first!', 'warning');
                return;
            }
            if (!clue.clue2 || clue.clue2.trim() === '') {
                showToast('No 2nd language', 'warning');
                return;
            }
            flippedClues[clue.id] = !flippedClues[clue.id];
            if (flippedClues[clue.id]) {
                hasOpenedSecondLang.value = true;
            }
        };

        // Active clue computed property
        const activeClue = computed(() => {
            if (activeRow.value === -1 || activeCol.value === -1) return null;
            const cell = gridCells.value[activeRow.value][activeCol.value];
            if (!cell || !cell.isActive) return null;
            const wordIds = cell.words;
            return placedWords.value.find(p => wordIds.includes(p.id) && p.direction === activeDirection.value) || null;
        });

        // Compute words count excluding words that had double-click reveals
        const getUnrevealedWordCount = () => {
            let unrevealedCount = 0;
            placedWords.value.forEach(p => {
                let wordRevealed = false;
                for (let i = 0; i < p.word.length; i++) {
                    const cx = (p.direction === 'across') ? p.x + i : p.x;
                    const cy = (p.direction === 'across') ? p.y : p.y + i;
                    const cell = gridCells.value[cy][cx];
                    if (cell && cell.revealed) {
                        wordRevealed = true;
                        break;
                    }
                }
                if (!wordRevealed) {
                    unrevealedCount++;
                }
            });
            return unrevealedCount;
        };

        const speedDisplay = computed(() => {
            const count = getUnrevealedWordCount();
            return (count / Math.max(1, timerSeconds.value)).toFixed(3);
        });

        // Copy AI prompt for a solved word to clipboard
        const copyWordPrompt = async (wordEntry) => {
            try {
                const prompt = buildWordPrompt(wordEntry.word, wordEntry.clue, wordEntry.clue2);
                await navigator.clipboard.writeText(prompt);
                showToast(`📋 Copied prompt for "${wordEntry.word}" to clipboard!`, 'success');
            } catch (e) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = buildWordPrompt(wordEntry.word, wordEntry.clue, wordEntry.clue2);
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast(`📋 Copied prompt for "${wordEntry.word}"!`, 'success');
            }
        };

        // Close the completion overlay but stay on game page
        const closeCompletionOverlay = () => {
            showCompletionOverlay.value = false;
        };

        // Check each clue and add newly solved words to solvedWords list (real-time)
        const checkSolvedWords = () => {
            const allClues = [...acrossClues.value, ...downClues.value];
            
            const currentlyCorrectKeys = new Set();
            const correctClues = [];
            
            allClues.forEach(clue => {
                let allCorrect = true;
                for (let i = 0; i < clue.word.length; i++) {
                    const cx = (clue.direction === 'across') ? clue.x + i : clue.x;
                    const cy = (clue.direction === 'across') ? clue.y : clue.y + i;
                    const cell = gridCells.value[cy] && gridCells.value[cy][cx];
                    if (!cell || cell.guess.trim().toUpperCase() !== clue.word[i].toUpperCase()) {
                        allCorrect = false;
                        break;
                    }
                }
                
                if (allCorrect) {
                    const key = clue.word + '_' + clue.direction;
                    currentlyCorrectKeys.add(key);
                    correctClues.push(clue);
                }
            });
            
            const filteredSolved = solvedWords.value.filter(sw => {
                const key = sw.word + '_' + sw.direction;
                return currentlyCorrectKeys.has(key);
            });
            
            const existingKeys = new Set(filteredSolved.map(sw => sw.word + '_' + sw.direction));
            
            correctClues.forEach(clue => {
                const key = clue.word + '_' + clue.direction;
                if (!existingKeys.has(key)) {
                    filteredSolved.push({
                        word: clue.word,
                        clue: clue.clue,
                        clue2: clue.clue2 || '',
                        direction: clue.direction,
                        number: clue.number
                    });
                }
            });
            
            solvedWords.value = filteredSolved;
        };

        const handleCellKeydown = (e, r, c) => {
            const key = e.key;

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

            if (key === 'Backspace') {
                e.preventDefault();
                const cell = gridCells.value[r][c];
                if (!cell.revealed) {
                    cell.guess = '';
                    cell.checked = false;
                }

                let nextR = (activeDirection.value === 'down') ? r - 1 : r;
                let nextC = (activeDirection.value === 'across') ? c - 1 : c;

                if (gridCells.value[nextR] && gridCells.value[nextR][nextC] && gridCells.value[nextR][nextC].isActive) {
                    focusCell(nextR, nextC);
                }
                checkSolvedWords();
                return;
            }

            if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                if (/^[a-zA-Z]$/.test(key)) {
                    const cell = gridCells.value[r][c];
                    if (!cell.revealed) {
                        cell.guess = key.toUpperCase();
                        cell.checked = false;
                    }

                    let nextR = (activeDirection.value === 'down') ? r + 1 : r;
                    let nextC = (activeDirection.value === 'across') ? c + 1 : c;

                    if (gridCells.value[nextR] && gridCells.value[nextR][nextC] && gridCells.value[nextR][nextC].isActive) {
                        focusCell(nextR, nextC);
                    }
                    // Check for newly solved words after input
                    checkSolvedWords();
                    checkAutoCompletion();
                }
            }
        };

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
                const params = new URLSearchParams();
                
                if (rankingFilter.value === 'selected' && selectedPlayDirs.value.length > 0) {
                    const labsKey = selectedPlayDirs.value.slice().sort().join('+');
                    params.append('labsKey', labsKey);
                } else {
                    params.append('labsKey', 'all');
                }
                
                if (leaderboardFilterSecondLang.value) {
                    params.append('onlySecondLang', 'true');
                } else {
                    params.append('onlySecondLang', 'false');
                }
                
                params.append('showGuests', leaderboardShowGuests.value ? 'true' : 'false');
                
                url += `?${params.toString()}`;
                
                const response = await fetch(url, { credentials: 'include' });
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
            const rawName = rankingForm.playerName.trim();
            if (!rawName) {
                showToast('⚠️ Please enter your player name before saving', 'warning');
                return;
            }
            if (selectedPlayDirs.value.length === 0) return;

            const name = currentUser.value ? rawName : `Guest_${rawName}`;

            submittingScore.value = true;
            try {
                const playerAvatar = currentUser.value
                    ? (currentUser.value.avatar || 'avatar1')
                    : guestAvatar.value;

                const payload = {
                    playerName: name,
                    playerAvatar,
                    labs: selectedPlayDirs.value,
                    wordCount: placedWords.value.length,
                    time: timerSeconds.value,
                    revealsUsed: revealCount.value,
                    unrevealedWordCount: getUnrevealedWordCount(),
                    useSecondLang: hasOpenedSecondLang.value
                };

                const response = await fetch(`${API_URL}/rankings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'include'
                });
                const data = await response.json();

                if (data.success) {
                    showToast('🏆 Score saved to leaderboard!', 'success');
                    scoreSubmitted.value = true;
                    // Auto-close overlay after 2 seconds
                    setTimeout(() => {
                        showCompletionOverlay.value = false;
                    }, 2000);
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
            fetchUserProfile();
            fetchCrosswordDirs();
            fetchRankings();
        });

        return {
            currentUser,
            toast,
            toastBorderColor,
            showToast,
            logoutPlayer,

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
            handleBackClick,
            checkAnswers,
            focusCell,
            isCellFocused,
            isCellInActiveWord,
            isClueActive,
            isClueFilled,
            selectClue,
            selectClueDirect,
            handleCellKeydown,

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
            zoomReset,
            
            // Stats panel dragging
            statsPanelStyle,
            startStatsDrag,
            isDraggingStats,
            swpPanelStyle,
            startSWPDrag,
            isDraggingSWP,

            // Play & Rankings states/actions
            crosswordDirs,
            dirsLoading,
            selectedPlayDirs,
            rankingFilter,
            rankingList,
            rankingLoading,
            scoreSubmitted,
            submittingScore,
            showCompletionOverlay,
            solvedWords,
            rankingForm,
            toggleSelectPlayDir,
            formatSeconds,
            selectedDirsDisplay,
            submitScore,
            backToSetupAfterPlay,
            copyWordPrompt,
            closeCompletionOverlay,
            formatRankDate,

            // Profile / Auth
            showProfileModal,
            showAuthModal,
            authModalTab,
            authForm,
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
            
            // Profile Performance Dashboard
            profileActiveTab,
            profileSelectedMetric,
            myScores,
            allScores,
            profileLoading,
            metrics,
            activeProfileMetricInfo,
            formatProfileMetricValue,
            profileUserStats,
            fetchProfileDashboardData,
            switchProfileTab,
            changeProfileMetric,
            updateProfileChart,

            // 2nd Language Features
            useSecondLang,
            leaderboardFilterSecondLang,
            leaderboardShowGuests,
            hasOpenedSecondLang,
            flippedClues,
            handleClueClick,
            activeClue,
            getUnrevealedWordCount,
            speedDisplay
        };
    }
}).mount('#app');
